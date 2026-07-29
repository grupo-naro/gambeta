# Monto de seña editable en Nueva reserva (con piso) — Design

**Fecha:** 2026-07-02
**Estado:** Aprobado
**Alcance:** reserva manual del panel (staff). El bot no cambia.
**Componentes:** frontend (Nueva reserva + páginas Hoy/Reservas) + backend (POST /reservas + validación + tests).

## Problema

Al agendar una reserva manual desde el panel, la reserva queda CONFIRMADA y hoy solo se puede elegir **Cobro = Nada / Seña / Total** (default Seña); el monto lo calcula el backend solo. Se quiere:
- Mostrar el **monto de la seña**, autocompletado con la seña por defecto de la cancha.
- Poder **subirlo** (si el cliente pagó de más, ej. seña $10.000 y transfirió $18.000) y que ese monto sea el que se registra como cobro.
- **Bloquear** la creación si el monto es **menor** al default de la cancha.

## Decisiones (con el usuario)
- El campo de monto aparece **solo** cuando Cobro = "Seña".
- Default del monto = **seña de la cancha** = `cancha.senaMonto` si está seteado, si no el `senaMontoFijo` global.
- Monto < default → **no deja crear la reserva** (aviso en el front + 422 en el back). Se puede subir el monto o cambiar el cobro a Total/Nada.
- "Total" = precio completo (como hoy). "Nada" = sin cobro (como hoy).
- El monto ingresado es el que se **registra como cobro** (captura el sobrepago).

## Backend

### Validador (`src/validators/reserva.schema.ts`)
- `createReservaSchema.body`: agregar `montoCobro: z.number().nonnegative().optional()`.

### Ruta (`src/routes/reserva.routes.ts`, handler `POST /`)
Reestructurar para **validar la seña ANTES de crear la reserva** (si no, un 422 dejaría una reserva huérfana ya creada). `canchaService` ya está importado; agregar `import { BusinessRule } from '../utils/errors.js';`.

```ts
reservaRoutes.post('/', authAny, validate(createReservaSchema), async (req, res, next) => {
  try {
    const body = (req as any).valid.body;
    const porStaff = req.principal?.kind === 'admin';

    // Pre-validación de la seña del panel (antes de crear, para no dejar reservas huérfanas)
    let defaultSena: number | undefined;
    if (porStaff && body.cobroInicial === 'sena') {
      const cancha = await canchaService.get(body.canchaId);
      defaultSena = await senaService.montoParaCancha(cancha, Number(cancha.precioHora));
      const monto = body.montoCobro ?? defaultSena;
      if (monto < defaultSena) throw BusinessRule('La seña no puede ser menor a la seña de la cancha');
    }

    const r = await reservaService.crear(body, { porStaff });

    if (porStaff && body.cobroInicial !== 'ninguno') {
      const precio = Number(r.monto);
      const monto = body.cobroInicial === 'total' ? precio : (body.montoCobro ?? defaultSena!);
      const adminId = req.principal?.kind === 'admin' ? req.principal.adminId : null;
      if (monto > 0) await cobroService.crear(r.id, { monto, medio: body.medioCobro }, adminId);
    }
    await auditService.log(req, { accion: 'CREAR', entidad: 'Reserva', entidadId: r.id, descripcion: 'Creó una reserva' });
    res.status(201).json(r);
  } catch (e) {
    next(e);
  }
});
```

(Nota: `montoParaCancha` ignora el `precio` para el fallback fijo; se pasa `cancha.precioHora` por consistencia de firma.)

### Tests (integración, `tests/integration/reserva-cobro.test.ts` nuevo o extendido)
Con token admin (porStaff), cancha con `senaMonto: 10000`, whatsapp nuevo:
- `cobroInicial: 'sena', montoCobro: 18000` → 201; el cobro de la reserva queda **18000** (verificar vía `GET /reservas/:id/cobros` o el registro).
- `cobroInicial: 'sena', montoCobro: 5000` (< 10000) → **422**, y la reserva **NO** se crea (contar reservas = 0).
- `cobroInicial: 'sena'` sin `montoCobro` → cobro = **10000** (default).
- `cobroInicial: 'total'` → cobro = **precioHora** (sin cambios).

## Frontend

### Tipo (`src/lib/types.ts`)
- `Cancha` ya tiene `senaMonto?: string | number | null`. Sin cambios (se usa `senaMontoFijo` de `Config`, que ya existe).

### Páginas que renderizan el diálogo
Ambas cargan las canchas; ahora también pasan `senaMontoFijo` (del config) al diálogo:
- `src/app/(panel)/reservas/page.tsx`: fetch del config (`GET /config` vía la acción/apiFetch que ya se use) y `<NuevaReservaDialog canchas={canchas} senaMontoFijo={Number(config.senaMontoFijo)} />`.
- `src/app/(panel)/hoy/page.tsx` → `agenda-hoy.tsx`: `hoy/page` pasa `senaMontoFijo` a `AgendaHoy`, y `AgendaHoy` lo reenvía a `<NuevaReservaDialog … senaMontoFijo={senaMontoFijo} />` (agregar la prop a `AgendaHoy`).

### Diálogo (`src/components/reservas/nueva-reserva-dialog.tsx`)
- Nueva prop: `senaMontoFijo: number`.
- Nuevo estado: `const [montoSena, setMontoSena] = useState('')`.
- Helper: `const canchaSel = canchas.find((c) => c.id === canchaId)`; `const senaDefault = (c?: Cancha) => { const propio = Number(c?.senaMonto ?? 0); return propio > 0 ? propio : senaMontoFijo; }` (mismo criterio que `montoParaCancha` del backend: `senaMonto` solo cuenta si es > 0, si no cae al global).
- **Prefill:** un `useEffect` sobre `[canchaId, cobro]` — si `cobro === 'sena'` y hay `canchaSel`, `setMontoSena(String(senaDefault(canchaSel)))`. En `resetForm`, `setMontoSena('')`.
- **Campo** (dentro del bloque de cobro, visible solo cuando `cobro === 'sena'`):
  ```tsx
  {cobro === 'sena' && (
    <div className="space-y-1">
      <Label htmlFor="nueva-monto-sena">Monto de la seña</Label>
      <Input id="nueva-monto-sena" type="number" min={senaDefault(canchaSel)} value={montoSena} onChange={(e) => setMontoSena(e.target.value)} />
      <p className="text-xs text-muted-foreground">Mínimo (seña de la cancha): ${senaDefault(canchaSel).toLocaleString('es-AR')}</p>
    </div>
  )}
  ```
- **Submit:** si `cobro === 'sena'`, validar antes de enviar:
  ```ts
  if (cobro === 'sena') {
    const def = senaDefault(canchaSel);
    const m = Number(montoSena);
    if (!m || m < def) { toast.error(`La seña no puede ser menor a $${def.toLocaleString('es-AR')}`); return; }
  }
  ```
  y agregar `montoCobro: cobro === 'sena' ? Number(montoSena) : undefined` al `crearReserva({...})`.

### Acción (`src/lib/reservas-actions.ts`)
- `crearReserva` input: agregar `montoCobro?: number`. Como el body se arma con `{ ...input, ... }`, `montoCobro` viaja solo (si es `undefined`, no molesta).

## Fuera de alcance
- El sobrepago que llega por **comprobante del bot** (aprobar-sena registra el monto fijo esperado, no el detectado) — es un fix aparte, pendiente si se decide.
- Editar el monto del cobro después de creada la reserva (ya existe el flujo de Cobros de la reserva).
- Cambiar el precio "Total".

## Integración
Backend → `main`; Frontend → `master`. **Igual que la feature de seña por cancha: commitear y dejar listo SIN pushear** (ya hay commits sin pushear encima). Dos repos.
