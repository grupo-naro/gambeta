# Confianza de cliente: solo manual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la confianza de un cliente (reservar sin seña) se active SOLO manualmente desde el panel, eliminando el auto-activado a las 2 reservas cumplidas.

**Architecture:** Backend: quitar la regla `cumplidas >= 2` en el cálculo de confianza de la reserva y en el campo `confianza` de `GET /clientes` (queda solo `confiable` manual + `porStaff`/`esContacto`). Frontend: quitar los textos que mencionan el automático.

**Tech Stack:** Backend Node/Express 5/TS/Prisma 7, Vitest+Supertest+Testcontainers (Docker). Frontend Next 16 (custom — ver `frontend/AGENTS.md`), pnpm.

## Global Constraints

- Confianza = `opts.porStaff || input.esContacto || clientePrevio.confiable`. Sin `cumplidas >= 2`.
- Se mantiene `porStaff` (reservas del panel siguen CONFIRMADA) y `esContacto` (ya es siempre false, se deja).
- `GET /clientes` sigue devolviendo `cumplidas` (informativo); `confianza` pasa a ser `c.confiable`.
- Frontend: NO usar training data de Next.
- Ramas: backend `feat/confianza-manual` (base `main`), frontend `feat/confianza-manual` (base `master`).
- **Push: a definir con el usuario al cierre** (el backend está deployado; este cambio afecta cómo el bot pide seña el lunes).

---

## REPO BACKEND (`canchitas-backend`, rama `feat/confianza-manual` desde `main`)

### Task 1: Quitar auto-confianza (servicio) + tests

**Files:**
- Modify: `backend/src/services/reserva.service.ts` (~línea 58)
- Modify: `backend/src/services/cliente.service.ts` (~línea 10)
- Test: `backend/tests/integration/clientes-confianza.test.ts`

**Interfaces:**
- Consumes: `clientePrevio.confiable`; `GET /clientes`, `POST /reservas` (x-api-key = bot).
- Produces: reserva del bot CONFIRMADA solo si `confiable`; `GET /clientes` `confianza === confiable`.

- [ ] **Step 1: Actualizar los tests (RED)**

En `backend/tests/integration/clientes-confianza.test.ts`:

Reemplazar el test de las líneas 33-38 (`'cliente con 2 reservas cumplidas → la siguiente CONFIRMADA (sin seña)'`) por:

```ts
  it('cliente con 2 reservas cumplidas pero NO confiable → sigue ESPERANDO_SENA (ya no auto)', async () => {
    await cumplidas(2);
    const r = await reservar();
    expect(r.body.estado).toBe('ESPERANDO_SENA');
  });
```

Y en el test de las líneas 52-59 (`'GET /clientes devuelve cumplidas y confianza'`), cambiar la aserción de confianza:

```ts
    expect(item.cumplidas).toBe(2);
    expect(item.confianza).toBe(false); // 2 cumplidas ya NO da confianza; solo el flag manual
```

(Los tests `cliente nuevo → ESPERANDO_SENA`, `1 cumplida → ESPERANDO_SENA` y `marcado confiable → CONFIRMADA` quedan igual — siguen siendo válidos.)

- [ ] **Step 2: Run tests to verify RED**

Run (desde `backend/`): `npx vitest run tests/integration/clientes-confianza.test.ts`
Expected: FAIL — con el código actual, "2 cumplidas" da CONFIRMADA (esperábamos ESPERANDO_SENA) y `confianza` da true (esperábamos false).

- [ ] **Step 3: Quitar la regla en `reserva.service.ts`**

En `backend/src/services/reserva.service.ts`, reemplazar la línea del cálculo de `confianza` (~línea 58):

```ts
    const confianza = opts.porStaff || input.esContacto || (!!clientePrevio && (clientePrevio.confiable || (await reservaRepo.contarCumplidasPorCliente(clientePrevio.id)) >= 2));
```

por:

```ts
    const confianza = opts.porStaff || input.esContacto || (!!clientePrevio && clientePrevio.confiable);
```

- [ ] **Step 4: Quitar la regla en `cliente.service.ts`**

En `backend/src/services/cliente.service.ts` (~línea 10), cambiar:

```ts
      return { ...c, cumplidas, confianza: c.confiable || cumplidas >= 2 };
```

por:

```ts
      return { ...c, cumplidas, confianza: c.confiable };
```

- [ ] **Step 5: Run tests to verify GREEN**

Run (desde `backend/`): `npx vitest run tests/integration/clientes-confianza.test.ts`
Expected: PASS (todo el archivo).

- [ ] **Step 6: Regresión de la suite**

Run (desde `backend/`): `npx vitest run`
Expected: sin regresiones nuevas. Si algún test asumía "2ª reserva del mismo cliente vía bot → CONFIRMADA", ajustarlo al nuevo comportamiento (ESPERANDO_SENA) y reportarlo. Los fallos pre-existentes de `sena.test.ts` por fecha vencida quedan fuera de alcance (reportar cuáles son).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/reserva.service.ts backend/src/services/cliente.service.ts backend/tests/integration/clientes-confianza.test.ts
git commit -m "feat(clientes): confianza solo manual (quita auto-activado a las 2 reservas)"
```

---

## REPO FRONTEND (`frontend`, rama `feat/confianza-manual` desde `master`)

### Task 2: Quitar textos del automático

**Files:**
- Modify: `frontend/src/components/clientes/clientes-table.tsx`

- [ ] **Step 1: Actualizar el subtítulo (~línea 37)**

Reemplazar:
```tsx
          <p className="mt-1 text-sm text-neutral-600">Los de confianza reservan sin seña (también automático a las 3 reservas).</p>
```
por:
```tsx
          <p className="mt-1 text-sm text-neutral-600">Los de confianza reservan sin seña.</p>
```

- [ ] **Step 2: Eliminar la nota muerta del auto-2 (~líneas 108-109)**

Eliminar por completo este bloque (dentro de la hoja del cliente, debajo del botón Marcar/Quitar de confianza):
```tsx
            {!seleccion.confiable && seleccion.confianza && (
              <p className="text-center text-xs text-neutral-500">Ya es de confianza por tener 2+ reservas cumplidas.</p>
            )}
```
(Ahora `confianza === confiable`, así que la condición nunca se cumple.)

- [ ] **Step 3: Typecheck + build**

Run (desde `frontend/`): `pnpm exec tsc --noEmit && pnpm build`
Expected: compila sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/clientes/clientes-table.tsx
git commit -m "feat(clientes): quitar textos de confianza automática (ahora solo manual)"
```

---

## Cierre por repo

- Backend: merge `feat/confianza-manual` → `main`. Frontend: merge → `master`.
- **Preguntar al usuario si pushear/deployar ahora** (afecta el go-live del lunes) o dejar commiteado sin push. Si se pushea el backend → auto-deploy (sin migración nueva, este cambio no toca el schema).

## Self-Review

- **Cobertura del spec:**
  - Quitar `>= 2` en reserva → Task 1 Step 3.
  - `confianza: c.confiable` en clientes → Task 1 Step 4.
  - Tests actualizados (2 casos) + suite → Task 1 Steps 1, 6.
  - Copy frontend (2 textos) → Task 2 Steps 1-2.
  - `porStaff`/`esContacto` sin cambios → se mantienen en la fórmula. ✓
- **Placeholders:** ninguno.
- **Consistencia:** `confianza = ... confiable` en reserva.service y `confianza: c.confiable` en cliente.service — mismo criterio; el frontend consume el campo del backend (sin recálculo).
