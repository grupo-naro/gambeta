# Suscripciones (socios) — Diseño

**Fecha:** 2026-07-29
**Estado:** Aprobado

## Objetivo

Permitir que el complejo tenga **socios**: clientes con una suscripción mensual que reservan
igual que cualquier otro, pero cuyos turnos quedan **100% bonificados** (sin seña y sin pago al
jugar).

Reglas del negocio:
- La suscripción **solo se da de alta desde el panel de administración**. No se vende por web ni
  hay autogestión del cliente.
- Incluye **todos los deportes** del complejo. No hay planes ni tipos de suscripción.
- Duración **mensual**, con **renovación manual** por parte del admin. No hay renovación
  automática ni cobro online.
- El socio **no** tiene cancha fija: sigue reservando turno por turno, con la misma experiencia
  que hoy. La única diferencia es que la reserva nace bonificada.

## Contexto (estado actual)

- **`reserva.service.crear`** concentra toda la decisión económica de una reserva:
  ```ts
  const confianza = opts.porStaff || input.esContacto || (!!clientePrevio && clientePrevio.confiable);
  const estado = confianza ? 'CONFIRMADA' : 'ESPERANDO_SENA';
  const precio = precioEfectivo(cancha, input.fecha, input.horaInicio, cfg);
  const montoSena = estado === 'ESPERANDO_SENA' ? (input.montoSena ?? await senaService.montoParaCancha(...)) : null;
  ```
  `Cliente.confiable` ya es el precedente exacto del patrón que necesitamos: un atributo del
  cliente que altera el flujo de reserva sin duplicar lógica.
- **Dos fuentes de verdad del dinero, distintas entre sí:**
  - **Caja** (`caja.service.ts`) suma filas de `Cobro`.
  - **Analíticas** (`analytics.service.ts`) suma `Reserva.monto` (4 consultas, 3 de ellas SQL crudo).
- **`Cobro`** ya tiene `origen` (valores en uso: `MANUAL`, `SENA`) y `medio` (`EFECTIVO`,
  `TRANSFERENCIA`). Hoy `reservaId` es obligatorio.
- **`caja.service.ts` ya es defensivo con la reserva ausente**: usa `c.reserva?.cancha` y
  `c.reserva?.cancha?.nombre ?? '-'`. Está preparado para cobros sin reserva.
- **`estadoPago()`** (`frontend/src/lib/pago.ts`) evalúa `saldo <= 0 && monto > 0` para mostrar
  "Pagado". Con `monto = 0` cae al final y muestra **"Debe $0"** — bug latente que este módulo
  destapa.
- **`pago.routes.ts`** rechaza generar preferencia de Mercado Pago si la reserva no está
  `ESPERANDO_SENA`.
- **`reserva.service.reprogramar`** documenta explícitamente que **el monto no se recalcula** al
  reprogramar ni al cambiar de cancha.
- La disponibilidad (`ocupacion.service.ts`, `ReservaSector`, exclusion constraint `btree_gist`)
  es independiente del precio.

## Decisiones tomadas

1. **Reserva bonificada = `monto: 0` + FK `suscripcionId`** (no un `Cobro` automático ni un flag
   con saldo forzado). En este código `monto` significa *"lo que el cliente debe pagar"*: ponerlo
   en 0 es fiel a esa semántica y deja intactos `saldo`, cobros, Sheets y Analíticas.
   Se agrega `montoLista` (nullable) con el precio que *hubiera* pagado: cuesta una columna y cero
   lógica, pero es información imposible de reconstruir después porque los precios cambian.
2. **La cuota entra a Caja como un `Cobro`** con `origen: 'SUSCRIPCION'`. `Cobro.reservaId` pasa a
   nullable y se agrega `Cobro.suscripcionId`. Se mantiene **una sola fuente de verdad del dinero**.
3. **El estado persistido es solo la intención del admin** (`ACTIVA` / `CANCELADA`). "Vencida"
   **no se guarda**: se deriva comparando `vencimiento` contra el día de hoy en `TZ_NEGOCIO`.
   **No hace falta ningún cron, scheduler ni workflow de n8n.**
4. **Cada renovación crea una fila nueva**, no mueve la fecha de la existente. Queda historial de
   períodos y "cliente con múltiples suscripciones" deja de ser un caso borde.
5. **La bonificación se congela al crear la reserva.** Si el socio reserva estando vigente, el
   turno queda bonificado para siempre, aunque se juegue después del vencimiento. Es el mismo
   criterio que ya usa `reprogramar` al no recalcular el monto.
6. **Sin límite de reservas bonificadas** (ni cupo mensual ni máximo de turnos activos).
7. **Canales:** panel de administración + web pública (`reservas/`). **El bot de WhatsApp (n8n)
   queda fuera de alcance.**

## Alcance

### Backend

**1. Migración — modelo `Suscripcion`**

```prisma
enum EstadoSuscripcion { ACTIVA  CANCELADA }

model Suscripcion {
  id          String            @id @default(cuid())
  clienteId   String
  cliente     Cliente           @relation(fields: [clienteId], references: [id])
  inicio      DateTime          @db.Date
  vencimiento DateTime          @db.Date
  estado      EstadoSuscripcion @default(ACTIVA)
  precio      Decimal?          @db.Decimal(10, 2)
  nota        String?
  creadoPorId String?
  creadoPor   AdminUser?        @relation(fields: [creadoPorId], references: [id])
  creadoEn    DateTime          @default(now())
  reservas    Reserva[]
  cobros      Cobro[]

  @@index([clienteId, vencimiento])
  @@index([estado, vencimiento])
}
```

`@db.Date` y no `Timestamptz`: la vigencia es un día calendario, no un instante. Mismo criterio
que `Bloqueo.fecha` y `TurnoFijoExcepcion.fecha`. **La comparación se hace siempre contra el día
de hoy en `TZ_NEGOCIO`**, nunca contra `new Date()` en UTC — de lo contrario una suscripción
vencería a las 21:00 hora argentina.

Índices: `[clienteId, vencimiento]` sirve la consulta caliente (corre en *cada* reserva);
`[estado, vencimiento]` sirve el listado del panel.

**2. Migración — cambios en tablas existentes**

```prisma
// Reserva
suscripcionId String?
suscripcion   Suscripcion? @relation(fields: [suscripcionId], references: [id])
montoLista    Decimal?     @db.Decimal(10, 2)
@@index([suscripcionId])

// Cobro
reservaId     String?      // ← pasa a nullable
reserva       Reserva?     @relation(fields: [reservaId], references: [id], onDelete: Cascade)
suscripcionId String?
suscripcion   Suscripcion? @relation(fields: [suscripcionId], references: [id])
@@index([suscripcionId])
```

Y el invariante como constraint real en la migración (mismo estilo que la exclusion constraint ya
existente en el repo):

```sql
ALTER TABLE "Cobro" ADD CONSTRAINT cobro_destino_unico
  CHECK (("reservaId" IS NULL) <> ("suscripcionId" IS NULL));
```

**`Cliente` no cambia.** No se agrega ningún flag `esSocio`: se derivaría de `Suscripcion` y
quedaría desincronizado.

**3. `suscripcion.repo.ts` + `suscripcion.service.ts` (nuevos)**

- `vigenteDe(clienteId: string, fecha?: string)` — **única función que decide si alguien es
  socio.** Devuelve la suscripción que cubre `fecha` (default: hoy en `TZ_NEGOCIO`), o `null`:
  `estado = 'ACTIVA' AND inicio <= fecha AND vencimiento >= fecha`. Si hubiera más de una
  (no debería, ver validación de solapamiento), toma la de mayor `vencimiento` → determinista.
  Recibe `clienteId`, no `whatsapp`: en `reserva.service.crear` el cliente ya se buscó por
  WhatsApp unas líneas antes (`clientePrevio`), así que se reutiliza esa consulta en vez de
  hacer un join extra.
- `crear({ clienteId, inicio, vencimiento, precio?, medio?, nota? }, adminId)` — en **una
  transacción**: valida solapamiento → crea `Suscripcion` → si hay `precio > 0`, crea el `Cobro`
  (`origen: 'SUSCRIPCION'`, `suscripcionId`, `reservaId: null`) → `auditLog`.
  `medio` es **obligatorio si `precio > 0`** (un `Cobro` sin medio no tiene sentido en Caja) y se
  ignora si no hay precio; lo valida el schema con un refinement.
- `renovar(id, { precio?, medio? }, adminId)` — crea una **fila nueva**:
  ```
  inicio      = max(hoy, vencimientoAnterior + 1 día)
  vencimiento = inicio + 1 mes
  ```
  Esa única fórmula cubre los dos casos: renovación **anticipada** (arranca al día siguiente del
  vencimiento, no pierde días pagos) y **tardía** (arranca hoy, no regala días retroactivos).
- `cancelar(id, adminId)` — `estado = 'CANCELADA'` + `auditLog`. **No** recalcula reservas ya
  bonificadas.
- `listar({ soloVigentes? })` — devuelve las suscripciones con el estado **derivado** para la
  vista (`ACTIVA` / `VENCIDA` / `CANCELADA`) y el conteo de turnos bonificados.

**4. Validators + rutas (`suscripcion.routes.ts`)**

Montadas en `/suscripciones` desde `routes/index.ts`. Todas con `authJwt` + `requireRole('ADMIN')`
(el alta de socios es administración, no operación de mostrador).

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/suscripciones` | Listado con estado derivado |
| GET | `/suscripciones/:id` | Detalle + historial de períodos del cliente |
| POST | `/suscripciones` | Alta |
| POST | `/suscripciones/:id/renovar` | Renovación (crea fila nueva) |
| PATCH | `/suscripciones/:id/cancelar` | Cancelación |

**5. `cobro.service.ts`**

Método nuevo `crearDeSuscripcion(suscripcionId, { monto, medio }, adminId)`. La ruta actual de
cobros de reserva no cambia. `cobroRepo.sumByReserva` / `listByReserva` siguen filtrando por
`reservaId` no nulo.

**6. `caja.service.ts`**

Agregar `porConcepto: { turnos, cuotas }` al reporte y una columna "concepto" en las filas, para
que las cuotas no queden mezcladas con los turnos. `porCancha` sigue igual: las cuotas no tienen
cancha y ya caen en `'-'` gracias al optional chaining existente.

**7. `reserva.service.ts` — integración (el único cambio en el camino crítico)**

Primero, **refactor sin cambio de comportamiento**: extraer la decisión económica de `crear()` a
una función pura y testeable sin base de datos:

```ts
resolverCondiciones(input, cancha, clientePrevio, suscripcion, cfg, opts)
  → { estado, monto, montoLista, montoSena, suscripcionId }
```

Hoy esa decisión (confianza → estado → precio → seña) está entrelazada con el `upsert` del cliente
y la transacción, y solo se puede testear levantando un contenedor. `crear()` ya tiene ~70 líneas
y depende de cinco servicios; sumarle un sexto sin extraer esto empuja el archivo en la dirección
equivocada.

Luego, la regla nueva dentro de esa función: si hay suscripción vigente →
`estado: 'CONFIRMADA'`, `monto: 0`, `montoLista: precioEfectivo(...)`, `suscripcionId`,
`montoSena: null`, y **no** se crea el registro `Pago`. Todo lo demás (sectores, exclusion
constraint, Sheets, auditoría, upsert del cliente) corre idéntico.

La suscripción tiene **prioridad sobre `esContacto` y `confiable`**: ambos llevan a `CONFIRMADA`
igual, pero solo la suscripción pone el monto en 0.

**8. `cliente.service.ts`**

`eliminar()` ya bloquea si el cliente tiene reservas; se extiende para bloquear también si tiene
suscripciones.

**No se tocan:** `ocupacion.service.ts`, `ReservaSector`, la exclusion constraint, `turnoFijo`,
`bloqueo`, `sena.service.ts` (deja de invocarse para socios, pero no cambia), las 4 consultas de
`analytics.service.ts` (con `monto = 0` quedan correctas solas), `pago.routes.ts` (su chequeo de
`ESPERANDO_SENA` funciona como defensa en profundidad), y el buffet.

### Frontend — panel (`frontend/`)

- **`app/(panel)/socios/page.tsx`** (Server Component): `apiFetch<Suscripcion[]>('/suscripciones')`
  → `SociosTable`.
- **`components/socios/socios-table.tsx`**: tabla desktop / cards mobile (patrón existente).
  Columnas: Cliente, WhatsApp, Vigencia (`inicio → vencimiento`), Estado (badge derivado:
  verde `Activa` / gris `Vencida` / rojo `Cancelada`), Turnos bonificados. Fila tocable → hoja
  (`ui/sheet`) con historial de períodos y acciones **Renovar** / **Cancelar** (esta última con
  `ui/confirm`, como el resto de las acciones destructivas del panel).
- **`components/socios/socio-dialog.tsx`**: alta. Reutiliza
  **`lib/use-cliente-autocomplete.ts`** (ya existe) para elegir cliente por WhatsApp o crear uno
  nuevo. Campos: cliente, inicio (default hoy), vencimiento (default +1 mes), precio y medio
  (opcionales), nota.
- **`lib/suscripciones-actions.ts`** (`'use server'`, **todos los exports `async function`**):
  `crearSuscripcion`, `renovarSuscripcion`, `cancelarSuscripcion`. Patrón
  `Result = { ok: true } | { ok: false, error }` + `revalidatePath`, como el resto de las actions.
- **`lib/pago.ts`**: `estadoPago()` suma el caso socio →
  `{ tono: 'pagado', label: 'Socio' }` cuando `suscripcionId != null`. **Esto también arregla el
  "Debe $0"** que aparecería con `monto = 0`.
- **`lib/types.ts`**: interfaces `Suscripcion` y `EstadoSuscripcionVista`; `Reserva` suma
  `suscripcionId?: string | null` y `montoLista?: number | null`.
- **`components/nav-items.ts`**: entrada `{ href: '/socios', label: 'Socios', icon: BadgeCheck,
  roles: SOLO_ADMIN, grupo: 'Administración' }`.
- El chip "Socio" aparece en `hoy/pago-chip.tsx` y en `reservas-table.tsx` sin cambios propios
  (ambos consumen `estadoPago`).

### Frontend — web pública (`reservas/`)

- `pantalla-reserva.tsx`: tras `crearReserva`, si la reserva vuelve **`CONFIRMADA` con
  `suscripcionId`**, saltea Mercado Pago y muestra directamente la confirmación con un mensaje de
  socio. La condición actual (`montoSena != null && montoSena > 0`) ya no se cumple para socios,
  así que el cambio es explícito pero mínimo.
- `lib/types.ts`: `ReservaCreada` suma `suscripcionId?: string | null`.
- **No se toca `lib/api.ts` ni `lib/actions.ts`**: la detección es del backend.

### Bot de WhatsApp (n8n)

**Sin cambios.** Fuera de alcance en esta iteración. Un socio que reserve por el bot va a seguir
el flujo normal con seña; el admin puede corregirlo desde el panel.

## Datos / flujo

**Alta.** Admin → `/socios` → "Nuevo socio" → elige cliente → fechas → precio/medio opcionales.
Backend en una transacción: valida solapamiento → crea `Suscripcion` → crea el `Cobro` de la cuota
si hay precio → `auditLog`.

**Renovación.** Botón "Renovar" en la fila → fila nueva con
`inicio = max(hoy, vencimientoAnterior + 1 día)` y `vencimiento = inicio + 1 mes` → cobro opcional
→ `auditLog`.

**Vencimiento.** No hay proceso. `vencimiento < hoy(TZ)` ⇒ no vigente.

**Reserva de socio (panel o web).** `crear()` consulta `vigenteDe(clientePrevio.id)` reutilizando
el cliente que ya buscó por WhatsApp. Si hay vigencia:
`CONFIRMADA`, `monto: 0`, `montoLista: <precio>`, `suscripcionId`, sin `montoSena` ni `Pago`.
En la web, la pantalla saltea Mercado Pago.

**Reserva sin suscripción.** Idéntica a hoy, sin ninguna diferencia.

**Cancelación de reserva bonificada.** Igual que hoy: no hay cobro que revertir y, al no haber
cupo, no hay crédito que devolver.

**Cancelar la suscripción.** `estado = CANCELADA`. Las reservas ya bonificadas se respetan.

## Manejo de errores / bordes

| Caso | Resolución |
|---|---|
| Suscripción vencida | Derivada por fecha; la reserva vuelve al flujo normal con seña |
| **Reserva el último día de vigencia** | `vencimiento` **inclusive**: vigente si `inicio ≤ hoy ≤ vencimiento` en `TZ_NEGOCIO` |
| Turno para fecha posterior al vencimiento | Bonificado (congelado al crear) |
| Renovación anticipada | `inicio = vencimientoAnterior + 1 día`; no pierde días pagos |
| Renovación tardía | `inicio = hoy`; no se regalan días retroactivos |
| Múltiples suscripciones por cliente | Normal: es el historial. Se bloquea el **solapamiento**, no la multiplicidad (409) |
| Dos vigentes a la vez | Imposible por el check anterior. Si ocurriera, `vigenteDe` toma la de mayor `vencimiento` |
| Suscripción cancelada con turnos futuros | Se respetan (congelado) |
| Renovar una suscripción cancelada | Permitido: crea una fila nueva desde hoy. La cancelada no cuenta para el solapamiento |
| Eliminar un cliente con suscripciones | Bloqueado (409), igual que hoy con reservas |
| Reprogramar / mover de cancha un turno bonificado | Sigue bonificado; el monto ya no se recalcula hoy |
| Alta de suscripción y reserva en simultáneo | Sin lock. Peor caso: paga un turno que podía ser gratis. No justifica complejidad |
| `precio` ausente en el alta | Válido: suscripción sin cobro registrado (el complejo la cobró por fuera) |
| `precio > 0` sin `medio` | Rechazado por el validator (400) |
| `vencimiento < inicio` | Rechazado por el validator (400) |
| Cliente que no existe todavía reserva | `clientePrevio` es `null` ⇒ no hay suscripción ⇒ flujo normal. Un cliente nuevo nunca puede ser socio, porque el alta de socio crea el cliente primero |

## Pruebas

**Backend (Testcontainers):**
- **Unitarios (sin DB):** `vigenteDe` con fecha anterior, primer día, día intermedio, **último día
  (inclusive)**, día posterior. Fórmula de `renovar` anticipada y tardía. `resolverCondiciones`
  extraída: socio → `monto 0` + `suscripcionId`; confiable → `CONFIRMADA` con precio; cliente nuevo
  → `ESPERANDO_SENA` con seña.
- **Integración:** alta crea suscripción + `Cobro` con `origen SUSCRIPCION` y `reservaId` null;
  alta solapada → 409; `POST /reservas` de un socio → `CONFIRMADA`, `monto 0`, `montoSena null`,
  `montoLista` con el precio real y **sin** registro `Pago`; reserva de no socio sin regresión;
  renovación anticipada y tardía; cancelar suscripción no altera reservas existentes; eliminar
  cliente con suscripción → 409; el CHECK `cobro_destino_unico` rechaza un cobro con ambos IDs o
  con ninguno; Caja incluye la cuota y la separa por concepto.
- **Regresión obligatoria:** que la suite completa siga verde tras hacer `Cobro.reservaId`
  nullable.

**Frontend:** `pnpm lint` + `pnpm build` obligatorios en `frontend/` y `reservas/`. Test unitario
de `estadoPago` para el caso socio (incluye la verificación de que ya no aparece "Debe $0"). QA
manual: alta, renovación, cancelación, y una reserva de socio desde panel y desde la web.

## Despliegue / compat

- Rama `feat/suscripciones` → `main` → deploy VM (`migrate deploy` corre solo al arrancar el
  contenedor).
- **Las fases 1 a 3 son puramente aditivas**: con ellas mergeadas el sistema se comporta
  exactamente igual que hoy. Recién la fase 4 modifica el camino crítico de reservas, y llega con
  el refactor y los tests ya en su lugar.
- La única migración sobre datos productivos es `Cobro.reservaId` → nullable. El `ALTER` es no
  destructivo y reversible.
- **`tests/helpers/db.ts::resetTables`**: hay que insertar `suscripcion.deleteMany()` **después**
  de `reserva` y **antes** de `cliente`. Si se omite, toda la suite de integración falla con
  violaciones de FK.

## Riesgos conocidos

- **Duplicación de la regla de vigencia.** Mitigado con una única función `vigenteDe()`; el
  frontend nunca decide, solo muestra lo que el backend resolvió.
- **Acoplamiento en `crear()`.** Mitigado extrayendo `resolverCondiciones` (fase 4, tarea 12).
- **Inconsistencia preexistente entre Caja y Analíticas.** Analíticas suma `Reserva.monto` y Caja
  suma `Cobro`; con las cuotas, Caja verá ingresos que Analíticas nunca contará. Es anterior a
  este módulo, que lo agrava. Unificarlo es un proyecto propio — **fuera de alcance**, se deja
  documentado.
- **Escalabilidad:** ninguna. `vigenteDe` es un index scan por `[clienteId, vencimiento]`, una
  consulta por reserva.

## Fuera de alcance (YAGNI)

- Cupos, límites de turnos bonificados o máximo de turnos activos (decisión explícita: sin límite).
- Planes o tipos de suscripción; suscripciones por deporte.
- Renovación automática, cobro online de la cuota, recordatorios de vencimiento.
- Autogestión del socio (ver o renovar su suscripción desde la web).
- Reconocimiento del socio en el **bot de WhatsApp (n8n)**.
- Suscripciones familiares o grupales (una suscripción, varios clientes).
- Beneficios parciales (descuento porcentual en vez de bonificación total).
- Cancha fija para socios (excluido explícitamente por el pedido).
- Unificar Caja y Analíticas en una sola fuente de verdad del dinero.
