# Grilla — ocultar horarios pasados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la grilla de disponibilidad no muestre, para HOY, los horarios cuyo inicio ya pasó (para fechas futuras no cambia).

**Architecture:** Cambio de una línea de lógica en `disponibilidadService.grilla`: al recorrer los slots libres de cada cancha, se descartan los que ya empezaron (comparando `inicioUtc` del slot contra ahora). Frontend sin cambios; sin migraciones.

**Tech Stack:** Node 22, Express, Prisma 7 + Postgres, vitest + supertest + testcontainers.

## Global Constraints

- Para HOY, un horario aparece solo si su inicio es **posterior a ahora** (`new Date(s.inicioUtc).getTime() > Date.now()`). Coincide con la regla de `reservaService.crear` ("No se puede reservar en el pasado").
- Fechas futuras: sin efecto (sus slots tienen `inicioUtc` futuro).
- Solo se toca `disponibilidadService.grilla` (no `listar`/`listarPorTamano`).
- Tests: testcontainers; `x-api-key: 'svc'`; config vía `configService.update({ horaApertura, horaCierre })`.
- No tocar `ortigoza/`.

---

## Task 1: Filtrar horarios pasados en `grilla`

**Files:**
- Modify: `backend/src/services/disponibilidad.service.ts` (método `grilla`)
- Test: `backend/tests/integration/disponibilidad-grilla.test.ts`

**Interfaces:**
- `disponibilidadService.grilla(deporte, fecha)` — misma firma; para HOY excluye horas pasadas.

- [ ] **Step 1: Actualizar los tests existentes a fecha futura + agregar el caso de hoy (fallan primero)**

Los casos actuales usan la fecha fija `2026-06-12`, que ahora quedaría en el pasado (grilla vacía). Cambiarlos a una fecha futura fija y agregar el caso de "hoy".

En `backend/tests/integration/disponibilidad-grilla.test.ts`:

a) Reemplazar las 3 apariciones de `fecha=2026-06-12` por `fecha=2099-06-13` en los `it` de "futbol", "una celda ocupada" y "padel". (El caso `deporte=tenis` puede quedar con cualquier fecha; también pasalo a `2099-06-13` por consistencia.)

b) En el caso "una celda ocupada", actualizar las fechas del reserva/reservaSector de `2026-06-12T21:00:00.000Z` / `...22:00...` a `2099-06-13T21:00:00.000Z` / `2099-06-13T22:00:00.000Z` (18:00 ART = 21:00 UTC; Argentina es UTC-3 todo el año).

c) Agregar este `it` nuevo al final del `describe`:
```ts
  it('para hoy no muestra horarios ya pasados', async () => {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
    // Ventana amplia arrancando 00:00: la hora 00:00 de hoy siempre está en el pasado.
    await configService.update({ horaApertura: '00:00', horaCierre: '23:00' });
    const res = await mostrador(supertest(app).get(`/disponibilidad/grilla?deporte=futbol&fecha=${hoy}`));
    expect(res.status).toBe(200);
    expect(res.body.horas).not.toContain('00:00'); // 00:00 de hoy ya pasó → no figura
  });
```

- [ ] **Step 2: Correr los tests (deben fallar)**

```bash
cd backend && npm test -- disponibilidad-grilla
```
Expected: el caso nuevo "para hoy no muestra horarios ya pasados" FALLA (hoy `grilla` todavía devuelve `00:00`). Los casos con `2099-06-13` deberían pasar aún sin el cambio (fecha futura), confirmando que solo cambia el comportamiento de "hoy".

- [ ] **Step 3: Implementar el filtro en `grilla`**

En `backend/src/services/disponibilidad.service.ts`, dentro de `grilla`, reemplazar el cuerpo del `for (const c of canchas)` para descartar los slots ya empezados:
```ts
    for (const c of canchas) {
      const { slots } = await this.listar(c.id, fecha);
      const futuros = slots.filter((s) => new Date(s.inicioUtc).getTime() > Date.now());
      const free = new Set(futuros.map((s) => s.horaInicio));
      perCancha.push({ id: c.id, nombre: c.nombre, free });
      for (const h of free) horasSet.add(h);
    }
```
(El resto del método queda igual: `horas` se arma de `horasSet`, y `libres[canchaId][hora] = free.has(hora)`.)

- [ ] **Step 4: Correr los tests (deben pasar)**

```bash
cd backend && npm test -- disponibilidad-grilla
```
Expected: pasan todos, incluido el nuevo caso de hoy.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/disponibilidad.service.ts backend/tests/integration/disponibilidad-grilla.test.ts
git commit -m "feat(disponibilidad): la grilla oculta horarios ya pasados (hoy)"
```

---

## Notas de cierre

- `listar` devuelve `Slot` con `inicioUtc` (ISO absoluto), así que la comparación con `Date.now()`
  es correcta en cualquier zona horaria — no depende de la hora del servidor local.
- El frontend no cambia: renderiza las `horas` que devuelve la grilla.
