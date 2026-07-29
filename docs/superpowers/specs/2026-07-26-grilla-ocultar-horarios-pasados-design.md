# Grilla — ocultar horarios pasados — Diseño

**Fecha:** 2026-07-26
**Objetivo:** En la web de reservas, para el día de HOY, que **no figuren** los horarios que ya
pasaron (hoy la grilla los muestra como "Libre" y recién falla al confirmar). Se resuelve en el
backend, en el armado de la grilla.

## Decisión

- Para HOY: los horarios cuyo inicio ya pasó **no aparecen** (la grilla arranca en el próximo
  horario disponible).
- Para fechas futuras: sin cambios (todos los horarios son futuros).
- Se resuelve en el **backend** (`disponibilidadService.grilla`), fuente única de verdad. El
  frontend no cambia (solo renderiza las horas que recibe).

## Cambio

En `disponibilidadService.grilla(deporte, fecha)`, al recorrer los slots libres de cada cancha,
**descartar los que ya empezaron**: se conserva un slot solo si su `inicioUtc` es posterior a
"ahora" (`new Date(s.inicioUtc).getTime() > Date.now()`). Esto filtra tanto la pertenencia de la
celda (`libres`) como la unión de `horas`. Coincide con la regla que `reservaService.crear` ya
aplica (`No se puede reservar en el pasado`).

- Efecto: hoy, las filas de horas pasadas desaparecen; fechas futuras, sin efecto (sus slots
  tienen `inicioUtc` futuro).
- Sin migraciones. Solo `disponibilidad.service.ts`.

## Testing

- Actualizar `backend/tests/integration/disponibilidad-grilla.test.ts`: los casos existentes usan
  una fecha fija ya pasada (`2026-06-12`), que con el filtro quedaría vacía → cambiarlos a una
  **fecha futura fija** (p. ej. `2099-06-13`) para que sigan verificando el armado de la grilla.
- Agregar un caso: para **hoy** (fecha calculada en la zona `America/Argentina/Buenos_Aires`),
  toda hora devuelta en `horas` tiene inicio posterior a "ahora" (invariante determinística:
  ninguna hora pasada aparece).

## Criterios de éxito

1. Para hoy, la grilla no muestra horarios cuyo inicio ya pasó.
2. Para fechas futuras, la grilla muestra la franja completa como hasta ahora.
3. Sin cambios en el frontend ni en la base.

## Fuera de alcance

- Bloquear/mostrar en gris en vez de ocultar (se eligió ocultar).
- Cualquier cambio en `listar`/`listarPorTamano` (solo se toca `grilla`).
