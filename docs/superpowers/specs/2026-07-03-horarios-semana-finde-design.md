# Horarios semana / finde (con cierre a medianoche) — Design

**Fecha:** 2026-07-03
**Estado:** Aprobado
**Componentes:** backend (config + disponibilidad + hoja + tests) + frontend (config form + calendario/heatmap + validadores). Bot: follow-up menor opcional. Dos repos.

## Problema

Hoy el complejo tiene un **único horario global** (`Configuracion.horaApertura`/`horaCierre`), usado por disponibilidad, hoja espejo, calendario y heatmap. Pero funciona **Lun-Vie 09:00–00:00** y **Sáb-Dom 16:00–00:00**. Se necesita horario por grupo (semana/finde) y **soportar cierre a medianoche (00:00)** — hoy con cierre "00:00" no se generaría ningún turno (00 < 09).

## Decisiones (con el usuario)
- Granularidad: **2 grupos** — Semana (Lun-Vie) y Finde (Sáb-Dom). No por-día ni por-cancha.
- Cierre `"00:00"` = **fin del día (medianoche / 24:00)**; último turno reservable **23:00–00:00**.
- Se **reutilizan** `horaApertura`/`horaCierre` existentes como los de **semana**; se agregan `horaAperturaFinde`/`horaCierreFinde`.

## Backend

### Modelo + migración (`Configuracion`)
Agregar dos campos (los `horaApertura`/`horaCierre` actuales quedan como **semana**):
```prisma
  horaAperturaFinde String @default("16:00")
  horaCierreFinde   String @default("00:00")
```
Migración a mano (`ALTER TABLE "Configuracion" ADD COLUMN ...` con default). ⚠️ Recordar `prisma migrate deploy` al deployar.

### Helper de medianoche (compartido, en `utils/tz.ts` o `disponibilidad`)
```ts
/** Minutos desde 00:00; "00:00" como cierre = fin del día (24:00 = 1440). */
export function cierreMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const min = h * 60 + m;
  return min === 0 ? 1440 : min;
}
```

### Helper semana/finde
```ts
/** Devuelve {apertura, cierre} del día según semana (Lun-Vie) o finde (Sáb/Dom). */
function horarioDe(fecha: string, cfg): { apertura: string; cierre: string } {
  const dow = dayOfWeekInTz(fecha, TZ); // 0=domingo .. 6=sábado
  const finde = dow === 0 || dow === 6;
  return finde
    ? { apertura: cfg.horaAperturaFinde, cierre: cfg.horaCierreFinde }
    : { apertura: cfg.horaApertura, cierre: cfg.horaCierre };
}
```

### `disponibilidad.service` (CRÍTICO)
- `listar` (loop ~línea 32): reemplazar `fromHHMM(cfg.horaApertura)` / `fromHHMM(cfg.horaCierre)` por el `horarioDe(fecha)` y `cierreMin(cierre)`:
  ```ts
  const { apertura, cierre } = horarioDe(fecha, cfg);
  for (let t = fromHHMM(apertura); t + SLOT_MIN <= cierreMin(cierre); t += SLOT_MIN) { ... }
  ```
- `listarPorTamano` (el que usa el bot): aplicar el **mismo** cambio en su loop de generación de slots (usa `horarioDe(fecha)` + `cierreMin`). Verificar en el archivo si comparte helper con `listar` o tiene su propio loop; en ambos casos debe quedar consistente.

### `config` (schema / service / routes)
- `config.schema.ts`: aceptar `horaAperturaFinde`/`horaCierreFinde` (`hhmm.optional()`). El refine de `apertura < cierre` debe usar **cierre efectivo** (`cierreMin`): validar para **ambos** pares (semana y finde) que `fromHHMM(apertura) < cierreMin(cierre)`. Así `09:00 < 00:00(→1440)` es válido, y `apertura = 00:00` sería inválido.
- `config.service.ts`: incluir los nuevos campos en el patch/validación.
- `config.routes.ts`: labels de auditoría para los 2 campos nuevos.
- `GET /config` los devuelve automáticamente (están en el modelo).

### Hoja espejo (`sheets/sheetsData.ts`)
- `horasDeConfig`: hacerla midnight-aware (cierre `"00:00"` → hasta la hora 23 inclusive). Ej.: `const finH = cierreMin(horaCierre) / 60;` y `for (let h = Number(horaApertura.slice(0,2)); h < finH; h++)`.
- `dataSemana`: usar el **rango unión** (mín apertura, máx cierre efectivo de semana+finde) para las filas del grid: `horasDeConfig(minApertura, maxCierre)`. (Un solo grid semanal; las horas que un día no tiene simplemente quedan vacías. Per-día-por-pestaña queda fuera de alcance.)

## Frontend

### `types.ts`
`Config`: agregar `horaAperturaFinde: string; horaCierreFinde: string`.

### Configuración (`config-form.tsx`)
Reemplazar el par único Apertura/Cierre por **2 pares** rotulados:
- **"Semana (Lun a Vie)"** → `horaApertura` / `horaCierre`.
- **"Finde (Sáb y Dom)"** → `horaAperturaFinde` / `horaCierreFinde`.
Cuatro `<input type="time">`. El estado inicial y el payload incluyen los 4 campos.

### Validador (`validators.ts` `configSchema`)
- Sumar `horaAperturaFinde`/`horaCierreFinde` (`hhmm`).
- El refine `apertura < cierre` pasa a validar **ambos pares** con cierre midnight-aware (helper local: `"00:00"` → `24*60`). Mensaje por par.

### Calendario + heatmap (rango unión, midnight-aware)
- `lib/calendario.ts` `horasDelDia(apertura, cierre)`: midnight-aware — si `cierre` es `"00:00"`, tratar el fin como hora **24** (mostrar hasta 23:00). 
- `calendario/page.tsx`: pasar a `CalendarioSemana` el **rango unión**: `apertura = min(horaApertura, horaAperturaFinde)`, `cierre = el de mayor cierre efectivo` (comparar con midnight-aware; si alguno es `"00:00"` gana como cierre máximo). Así ningún turno (semana ni finde) queda fuera de la grilla.
- `dashboard/ocupacion-heatmap.tsx`: mismo criterio midnight-aware + rango unión (el `dashboard/page.tsx` le pasa el rango unión).

## Bot (n8n) — follow-up menor, OPCIONAL, fuera de este spec
- La **disponibilidad** que ofrece el bot ya sale correcta (viene de `/disponibilidad/por-tamano` que ahora usa `horarioDe`).
- El FAQ "¿a qué hora abren?" hoy responde `cfg.horaApertura/Cierre` (= semana). Mejora opcional posterior: que responda "Lun a Vie 9 a 00, findes 16 a 00". No bloquea el go-live.

## Testing
- **Unit `cierreMin`**: `"00:00"`→1440, `"23:00"`→1380, `"09:00"`→540.
- **Integración disponibilidad**: con semana 09-00 y finde 16-00 → un **martes** ofrece slots desde 09:00; un **sábado** desde 16:00; en ambos el último slot es **23:00–00:00** (y existe el 23:00). Un día del grupo reducido ofrece menos slots.
- **Validador config**: `{semana 09:00/00:00, finde 16:00/00:00}` válido; `apertura 00:00` inválido; `finde apertura 20:00 / cierre 18:00` inválido.
- Frontend: unit del `configSchema` con los 4 campos; `pnpm build`.

## Fuera de alcance
- Horarios **por día** individual (7) o **por cancha** (`HorarioDisponible` sigue sin usar).
- Turnos que **cruzan** medianoche hacia el día siguiente (ej. abrir 22:00 y cerrar 02:00). Solo se soporta cierre exactamente a `00:00` como fin del mismo día.
- Feriados / fechas especiales (se cubren con Bloqueo).
- Hoja: pestaña-por-día con su propio rango (queda el grid único con rango unión).

## Integración
Backend → `main` (+ migración). Frontend → `master`. **Commitear SIN pushear** (consistente con lo acumulado), salvo indicación contraria en el plan. Dos repos.
