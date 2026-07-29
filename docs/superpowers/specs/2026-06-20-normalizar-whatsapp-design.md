# Normalizar WhatsApp (panel → formato canónico del bot) — Design

**Fecha:** 2026-06-20
**Estado:** Aprobado

## Problema

El campo de número (WhatsApp) se carga a mano en el panel y se guarda crudo, tal cual lo tipean. El bot, en cambio, siempre usa el JID de WhatsApp `5491136620274` (sin `+`, con el `9` de celular). Cuando recepción/admin cargan un número en otro formato (ej. `+541136620274`, sin el `9`), no matchea con el bot.

Consecuencia real ya vista: un turno fijo cargado como `+541136620274` no se podía liberar por bot (el bot mandaba `5491136620274`). El mismo desfasaje afecta otras búsquedas exactas del bot: `mis_reservas`, dedupe de clientes y clientes de confianza.

> Nota: el match de **liberar fijos** ya se hizo tolerante (compara los últimos 10 dígitos, commit `3a54a60`). Este diseño ataca la causa raíz: que cualquier número que entre por el panel quede guardado en el formato canónico del bot, así matchea en TODOS lados.

## Objetivo

Que el recepcionista/admin pueda tipear el número local (ej. `1136620274`, 10 dígitos) y el sistema lo guarde canónico (`5491136620274`), mostrándolo en pantalla como `+54 9 11 3662-0274`.

**Alcance:** campos de número de **cliente**: nueva reserva, turno fijo, cliente. NO toca `adminWhatsapp` de Configuración (es el número del propio complejo, decisión aparte).

## Formato canónico

- **Se guarda:** `5491136620274` — sin `+`, exactamente el JID que usa el bot. Esto es lo que hace que matchee con las búsquedas exactas del bot y evita clientes duplicados.
- **Se muestra:** `+54 9 11 3662-0274` (el panel lo formatea para lectura; internamente sigue siendo `5491136620274`).

## Regla de normalización

Función `normalizarWhatsapp(raw)`. Trabaja sobre los dígitos (saca `+`, espacios, guiones, paréntesis):

1. `d = raw.replace(/\D/g, '')`.
2. Si `d` arranca con `00` → sacar ese `00` (prefijo de salida internacional).
3. Si `d` arranca con `0` → sacar ese `0` (prefijo troncal).
4. Resolver a `549` + 10 dígitos locales:
   - `d` empieza con `549` y tiene 13 díg. → ya canónico → `d`.
   - `d` empieza con `54` (12 díg., sin el 9) → `549` + los últimos 10.
   - `d` tiene exactamente 10 díg. (área + número) → `549` + `d`.
   - cualquier otro caso (no resuelve a `549` + 10) → **error** `BusinessRule('Número inválido. Ingresá los 10 dígitos: 11 1234 5678')`.
5. Resultado: siempre `549` + 10 dígitos = 13 dígitos. Si no, error.

Tabla de casos:

| Entrada | Sale |
|---|---|
| `1136620274` | `5491136620274` |
| `11 3662-0274` | `5491136620274` |
| `5491136620274` | `5491136620274` |
| `+54 9 11 3662-0274` | `5491136620274` |
| `+541136620274` (sin 9) | `5491136620274` |
| `01136620274` | `5491136620274` |
| `123` / vacío / basura | error (rechaza) |

**No se intenta** interpretar formatos viejos ambiguos (ej. `15` intercalado): se rechazan y se pide el número de 10 dígitos. YAGNI.

## Arquitectura

### Backend (fuente de verdad)
- **Nuevo** `src/utils/whatsapp.ts`: `normalizarWhatsapp(raw: string): string` (tira `BusinessRule` si no resuelve). Idempotente: `normalizarWhatsapp('5491136620274') === '5491136620274'`, así el input del bot pasa sin cambios.
- Se aplica como `.transform()` de Zod en los validadores:
  - `reserva.schema.ts` → `crearReservaSchema.body.whatsapp` (requerido).
  - `turnoFijo.schema.ts` → `crearTurnoFijoSchema.body.whatsapp` y el de update (opcional: si viene vacío/undefined, queda igual; si viene con valor, se normaliza).
  - `cliente.schema.ts` → schema de upsert y de patch (el campo whatsapp).
- El transform corre antes del service, así el valor que llega al service y a la DB ya es canónico. Como el bot pega a estos mismos endpoints con el número ya canónico, el transform es no-op para él.
- `liberarPorWhatsapp` queda con su match tolerante actual (no se toca); opcionalmente puede normalizar el target, pero el tolerante ya cubre.

### Frontend (UX)
- **Nuevo** `src/lib/whatsapp.ts`:
  - `aCanonico(raw): string | null` — misma regla que el backend; `null` si no resuelve.
  - `previewWhatsapp(raw): string | null` — devuelve el lindo `+54 9 11 3662-0274` o `null`.
- En los 3 diálogos (`nueva-reserva-dialog.tsx`, `turno-fijo-dialog.tsx`, `cliente-dialog.tsx`):
  - Texto en vivo bajo el input: "Se guardará como: +54 9 11 3662-0274" cuando resuelve; hint de error cuando no.
  - Se envía el texto crudo (el backend normaliza). El front no necesita transformar antes de enviar, solo validar/mostrar.
- Los validadores Zod del front (`validators.ts`) que hoy hacen `min(5)` pasan a validar que el número resuelva a un AR válido (reusando `aCanonico`).

## Datos existentes

Se dejan como están. Son pocos, el bot ya crea los clientes en formato canónico, y el liberar ya es tolerante. Corrección manual en el panel si hace falta. (Sin migración.)

## Errores

- Backend: número que no resuelve → 400 `BusinessRule` con mensaje claro.
- Frontend: validación inline en el form (no deja enviar) + hint con el formato esperado.

## Testing

- **Backend:** unit de `normalizarWhatsapp` cubriendo toda la tabla + casos de rechazo. Tests de integración existentes (reserva, fijos, liberar, clientes) siguen pasando (el transform es transparente para el input del bot).
- **Frontend:** unit de `aCanonico` / `previewWhatsapp` con la misma tabla.

## Integración

- Backend: rama feature → merge a `main` + push.
- Frontend: rama feature → merge a `master` local (no se pushea, como el flujo actual).
