# Reserva online — Web (Sub-proyecto A) — Diseño

**Fecha:** 2026-07-26
**Objetivo:** Una página web pública (app `reservas/`, Next.js) donde un cliente reserva una
cancha sin pasar por el bot: elige deporte → fecha → una **grilla tipo planilla** (filas =
horarios, columnas = canchas) para tocar una celda libre → carga nombre y teléfono → confirma, y
la reserva queda creada (esperando seña). El pago de la seña por Mercado Pago es el sub-proyecto B
(fuera de alcance acá).

## Decisiones tomadas

- **Sub-proyecto A primero** (web funcional), **B después** (Mercado Pago).
- **Flujo:** deporte → fecha → grilla (horarios × canchas del deporte) → celda libre → datos →
  confirmar.
- **Deporte → canchas:** *fútbol* = canchas cuyo `tipo` empieza con `futbol` (futbol5, futbol7…);
  *pádel* = `tipo` = `padel`.
- **Comunicación con el backend:** la app `reservas/` llama al backend **del lado del server**
  (server actions/route handlers) con `SERVICE_API_KEY` en el server; nada de credenciales en el
  navegador.
- **Despliegue:** Vercel, como sitio público aparte (igual que el panel).
- **Pantalla final (A, sin pago):** crea la reserva (`ESPERANDO_SENA`) y muestra que quedó
  registrada + el monto de la seña. En B, este paso redirige a Mercado Pago.
- Marca visible: **Grupo Naro**.

## Backend

- Nuevo endpoint **`GET /disponibilidad/grilla?deporte=&fecha=`** (`authAny`):
  - `deporte ∈ { futbol, padel }`; `fecha` = `YYYY-MM-DD`.
  - Resuelve las canchas activas del deporte (fútbol: `tipo` empieza con `futbol`; pádel:
    `tipo = 'padel'`), ordenadas por nombre.
  - Para cada cancha, reusa `disponibilidadService.listar(canchaId, fecha)` y arma la matriz.
  - Respuesta:
    ```json
    {
      "deporte": "futbol", "fecha": "2026-07-30",
      "canchas": [{ "id": "...", "nombre": "Cancha 1" }],
      "horas": ["16:00", "17:00", "..."],
      "libres": { "<canchaId>": { "16:00": true, "17:00": false } }
    }
    ```
  - `horas` = unión ordenada de todos los `horaInicio` posibles de las canchas del deporte ese
    día (para que la grilla tenga filas aunque una cancha no ofrezca cierto horario; una celda
    inexistente se trata como no disponible).
  - Validación: `deporte` enum, `fecha` regex `YYYY-MM-DD` (nuevo `grillaSchema` en
    `disponibilidad.schema.ts`). Implementado en `disponibilidadService.grilla(deporte, fecha)`.
- **Crear reserva:** se reusa `POST /reservas` (`authAny`) con `{ canchaId, whatsapp,
  nombreCliente, fecha, horaInicio, esContacto: false }`. Queda `ESPERANDO_SENA`; la respuesta
  incluye `montoSena` (lo muestra la web).

## App `reservas/` (Next.js 16, Tailwind ya scaffoldeado)

Estructura:
- `src/lib/api.ts`: helper server-side `apiReservas<T>(path, init)` que pega a `API_URL` con header
  `x-api-key: SERVICE_API_KEY` (server-only), patrón análogo a `buffet-api.ts` del panel.
- `src/lib/actions.ts` (server actions):
  - `getGrilla(deporte, fecha)` → `GET /disponibilidad/grilla`.
  - `crearReserva({ deporte, canchaId, fecha, horaInicio, nombre, telefono })` →
    `POST /reservas` (mapea `telefono`→`whatsapp`, `nombre`→`nombreCliente`). Devuelve
    `{ ok, data?: { id, montoSena }, error? }`.
- `src/app/page.tsx`: landing con hero "Grupo Naro" + botón **"Reservá tu cancha"** que lleva a
  `/reservar`.
- `src/app/reservar/page.tsx` + componente cliente `WizardReserva`:
  - Paso 1 **Deporte:** botones Fútbol / Pádel.
  - Paso 2 **Fecha:** input date (o selector de próximos días); mínimo hoy.
  - Paso 3 **Grilla:** tabla con filas = `horas`, columnas = `canchas`; cada celda libre es un
    botón, las ocupadas/inexistentes deshabilitadas. Al tocar una celda, guarda `canchaId` +
    `horaInicio` y avanza.
  - Paso 4 **Datos:** nombre + teléfono (validación mínima: nombre ≥ 2, teléfono con dígitos
    suficientes).
  - Paso 5 **Confirmar:** resumen (deporte, cancha, fecha, hora, nombre) → llama `crearReserva`.
    Éxito → pantalla "¡Listo! Tu reserva quedó registrada. Seña: $X. Te esperamos." Error →
    mensaje (p. ej. horario ya tomado) y volver a la grilla.
- Config: `.env.example` con `API_URL` y `SERVICE_API_KEY`; `README` con cómo correr/desplegar.

## Manejo de errores

- Grilla vacía (sin canchas del deporte o sin horarios): mensaje "No hay disponibilidad para ese
  día".
- Carrera (dos personas toman el mismo horario): `POST /reservas` devuelve 409 (constraint de
  solapamiento); la web muestra "Ese horario se acaba de ocupar" y recarga la grilla.
- Teléfono inválido para el backend (`whatsappCanonico`): la web valida antes y muestra el error.

## Testing

- **Backend (integración, testcontainers):** `GET /disponibilidad/grilla` — arma canchas del
  deporte, marca libres/ocupados correctamente (sembrar una reserva y verificar que esa celda
  quede `false`), filtra por deporte, valida `deporte`/`fecha`.
- **Web:** función pura de armado/normalización si se extrae (p. ej. validación de teléfono) +
  `npm run build`. El wizard se valida con build/typecheck (sin e2e en A).

## Criterios de éxito

1. Desde la web: deporte → fecha → grilla → celda libre → datos → reserva creada y visible en el
   panel como `ESPERANDO_SENA`.
2. La grilla refleja libres/ocupados de todas las canchas del deporte para la fecha.
3. La app no expone la `SERVICE_API_KEY` al navegador.
4. Pantalla final muestra el monto de la seña (el pago llega en B).

## Fuera de alcance (va en Sub-proyecto B)

- Mercado Pago (preferencia de pago, redirección, webhook, confirmación automática de la seña).
- Cuenta/estado "mis reservas" en la web, cancelación online, recordatorios.
- Login de clientes.
