# Reservas mobile — select de cancha + precio hora pico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En mobile, elegir la cancha con un `select` antes de ver los horarios, y mostrar el precio efectivo (base/pico) por hora de esa cancha. Desktop igual.

**Architecture:** El backend agrega a `/disponibilidad/grilla` un mapa `precios[canchaId][hora]` con el precio efectivo (`precioEfectivo`, base o pico según config). El frontend mobile suma un `<select>` de cancha y lista los horarios de la cancha elegida usando `libres`/`precios`; se quita la auto-asignación.

**Tech Stack:** Node 22, Express, Prisma 7 + Postgres, vitest + supertest + testcontainers (backend); Next.js 16 + React 19 + Tailwind v4 (app `reservas/`, pnpm).

## Global Constraints

- Solo cambia mobile; el desktop (grilla) queda intacto.
- Mobile: `<select>` de cancha (canchas del deporte, por nombre; default la primera). Lista de la cancha elegida: fila por hora → DISPONIBLE/Ocupado + precio efectivo. Sin auto-asignación.
- Precio efectivo = `precioEfectivo(cancha, fecha, hora, cfg)` (base o pico). La config de pico (`picoDesde/picoHasta`, finde) y `precioHoraPico` por cancha se administran en el panel; la web solo muestra.
- `reservas/` usa **pnpm** (nunca `npm install`). Sin cambios de secretos.
- Backend tests: testcontainers, `x-api-key: 'svc'`; config vía `configService.update(...)`.
- No tocar `ortigoza/`.

---

## Task 1: Backend — `precios` (precio efectivo por celda) en la grilla

**Files:**
- Modify: `backend/src/services/disponibilidad.service.ts` (método `grilla`)
- Test: `backend/tests/integration/disponibilidad-grilla.test.ts`

**Interfaces:**
- `grilla` devuelve además `precios: Record<string /*canchaId*/, Record<string /*hora*/, number>>` con el precio efectivo por celda.

- [ ] **Step 1: Importar `precioEfectivo` y agregar `precios` en `grilla`**

En `backend/src/services/disponibilidad.service.ts`:

a) Agregar el import (junto a los demás de arriba):
```ts
import { precioEfectivo } from './precio.service.js';
```

b) Reemplazar el método `grilla` por:
```ts
  async grilla(deporte: 'futbol' | 'padel', fecha: string): Promise<{
    deporte: string; fecha: string;
    canchas: { id: string; nombre: string; precioHora: number }[];
    horas: string[];
    libres: Record<string, Record<string, boolean>>;
    precios: Record<string, Record<string, number>>;
  }> {
    const todas = await canchaRepo.list(true);
    const canchas = todas.filter((c) =>
      deporte === 'futbol' ? c.tipo.toLowerCase().startsWith('futbol') : c.tipo.toLowerCase() === 'padel',
    );
    const cfg = await configService.get();
    const perCancha: { id: string; nombre: string; precioHora: number; precioHoraPico: number; free: Set<string> }[] = [];
    const horasSet = new Set<string>();
    for (const c of canchas) {
      const { slots } = await this.listar(c.id, fecha);
      const futuros = slots.filter((s) => new Date(s.inicioUtc).getTime() > Date.now());
      const free = new Set(futuros.map((s) => s.horaInicio));
      perCancha.push({ id: c.id, nombre: c.nombre, precioHora: Number(c.precioHora), precioHoraPico: Number(c.precioHoraPico), free });
      for (const h of free) horasSet.add(h);
    }
    const horas = [...horasSet].sort();
    const libres: Record<string, Record<string, boolean>> = {};
    const precios: Record<string, Record<string, number>> = {};
    for (const pc of perCancha) {
      libres[pc.id] = {};
      precios[pc.id] = {};
      for (const h of horas) {
        libres[pc.id][h] = pc.free.has(h);
        precios[pc.id][h] = precioEfectivo({ precioHora: pc.precioHora, precioHoraPico: pc.precioHoraPico }, fecha, h, cfg);
      }
    }
    return { deporte, fecha, canchas: perCancha.map((pc) => ({ id: pc.id, nombre: pc.nombre, precioHora: pc.precioHora })), horas, libres, precios };
  },
```
(Es el mismo método; se agrega `cfg`, `precioHoraPico` en `perCancha` y el mapa `precios`.)

- [ ] **Step 2: Escribir el test (falla primero)**

En `backend/tests/integration/disponibilidad-grilla.test.ts`, agregar (usa `configService`, ya importado en ese archivo):
```ts
  it('precios: refleja el precio efectivo (base fuera del pico, pico dentro)', async () => {
    // f1 = Futbol 1 (base 1000). Le damos precio pico y una ventana de pico.
    await getPrisma().cancha.update({ where: { id: f1 }, data: { precioHora: 1000, precioHoraPico: 3000 } });
    await configService.update({ picoDesde: '19:00', picoHasta: '21:00' }); // pico de semana 19-21
    // 2099-06-12 es viernes (día de semana); ventana 18-21 → horas 18,19,20
    const res = await mostrador(supertest(app).get('/disponibilidad/grilla?deporte=futbol&fecha=2099-06-12'));
    expect(res.status).toBe(200);
    expect(res.body.precios[f1]['18:00']).toBe(1000); // fuera del pico → base
    expect(res.body.precios[f1]['19:00']).toBe(3000); // dentro del pico → pico
    expect(res.body.precios[f1]['20:00']).toBe(3000);
  });
```

- [ ] **Step 3: Correr los tests**

```bash
cd backend && npm test -- disponibilidad-grilla
```
Expected: primero falla el caso nuevo (hoy no hay `precios`); tras el Step 1 pasan todos.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/disponibilidad.service.ts backend/tests/integration/disponibilidad-grilla.test.ts
git commit -m "feat(disponibilidad): la grilla incluye precios efectivos por celda (hora pico)"
```

---

## Task 2: Frontend — select de cancha en mobile (precio efectivo)

**Files:**
- Modify: `reservas/src/lib/types.ts` (`Grilla.precios`)
- Modify: `reservas/src/components/pantalla-reserva.tsx`

**Interfaces:**
- Consumes: `Grilla` con `precios` (Task 1). El desktop no cambia.

- [ ] **Step 1: Tipo `Grilla` con `precios`**

En `reservas/src/lib/types.ts`, dentro de `Grilla`, agregar debajo de `libres`:
```ts
  precios: Record<string, Record<string, number>>;
```

- [ ] **Step 2: Quitar `elegidaMobile` y agregar el estado del select**

En `reservas/src/components/pantalla-reserva.tsx`:

a) Borrar la función pura `elegidaMobile` completa (el `export function elegidaMobile(...) { ... }`).

b) Agregar el estado del select junto a los otros `useState` (por ejemplo después de `const [fecha, setFecha] = useState(hoyISO());`):
```tsx
  const [canchaSelId, setCanchaSelId] = useState('');
```

- [ ] **Step 3: Reescribir el bloque mobile (select + lista con precio efectivo)**

Reemplazar todo el bloque `{/* ===== Mobile: lista de horarios ===== */}` (la `<div className="flex flex-1 flex-col gap-4 p-4 md:hidden">…</div>`) por:
```tsx
      {/* ===== Mobile: select de cancha + lista ===== */}
      <div className="flex flex-1 flex-col gap-4 p-4 md:hidden">
        {deporteBotones}
        <SelectorFechaMobile value={fecha} onChange={setFecha} />
        <h2 className="text-base font-bold uppercase text-lime-400">{tituloGrilla}</h2>
        {cargando ? <p className="p-6 text-center text-neutral-500">Cargando…</p>
          : errorGrilla ? <p className="p-6 text-center text-red-400">{errorGrilla}</p>
          : sinDatos ? <p className="p-6 text-center text-neutral-500">No hay disponibilidad para ese día.</p>
          : (() => {
              const canchaSel = grilla!.canchas.find((c) => c.id === canchaSelId) ?? grilla!.canchas[0];
              return (
                <>
                  <select value={canchaSel.id} onChange={(e) => setCanchaSelId(e.target.value)}
                    className="w-full rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-neutral-100">
                    {grilla!.canchas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                  <div className="flex flex-col">
                    {grilla!.horas.map((h) => {
                      const libre = grilla!.libres[canchaSel.id]?.[h];
                      const precio = grilla!.precios[canchaSel.id]?.[h] ?? null;
                      return (
                        <div key={h} className="flex items-center gap-3 border-b border-neutral-800 py-3">
                          <span className="w-14 font-semibold tabular-nums text-neutral-300">{h}</span>
                          {libre ? (
                            <button type="button" onClick={() => abrirForm(canchaSel.id, canchaSel.nombre, h)}
                              className="flex-1 rounded-full bg-lime-500 py-3 text-center font-bold uppercase text-black active:scale-95">
                              Disponible
                            </button>
                          ) : (
                            <span className="flex-1 rounded-full bg-neutral-800 py-3 text-center font-semibold uppercase text-neutral-600">Ocupado</span>
                          )}
                          <span className="w-24 text-right font-semibold text-lime-400">{money(precio)}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
      </div>
```
(`canchaSel` se deriva del estado; si al cambiar de deporte la cancha anterior ya no existe, cae a `grilla.canchas[0]`. El `money(precio)` con `null` devuelve `''`.)

- [ ] **Step 4: Verificar build**

```bash
cd reservas && pnpm build
```
Expected: compila/typecheck limpio; `/reservar` generado. Confirmar que no quedó ninguna referencia a `elegidaMobile`: `grep -rn "elegidaMobile" reservas/src` vacío.

- [ ] **Step 5: Commit**

```bash
git add reservas/src/lib/types.ts reservas/src/components/pantalla-reserva.tsx
git commit -m "feat(reservas): select de cancha en mobile con precio efectivo (hora pico)"
```

---

## Notas de cierre

- Desktop y mobile siguen compartiendo estado y el mismo modal; el mobile ahora tiene su propio
  `canchaSelId`. El desktop no usa `precios` ni `canchaSelId`.
- Al elegir una cancha puntual, sus horas ocupadas se ven "Ocupado" (a diferencia de la vista
  auto-asignada anterior). Las horas pasadas siguen sin figurar (grilla las filtra).
- Sin migraciones; el único cambio de backend es el mapa `precios` en la grilla.
