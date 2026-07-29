# Bot: liberar turnos fijos + recurrente — Design

**Fecha:** 2026-06-17
**Estado:** Aprobado

## Objetivo

Que el bot maneje las **liberaciones** de turnos fijos (cuando el cliente avisa que no va un día, ese turno se libera y queda disponible para otros) y que, cuando el cliente pida un turno **recurrente** ("quiero todos los miércoles"), le ofrezca reservar el **próximo** día como turno suelto y le aclare que para dejarlo **fijo** debe ser **presencial**. Crear/eliminar turnos fijos **sigue siendo presencial** (el bot no lo hace).

## Contexto (estado actual)

- `TurnoFijo { id, canchaId, clienteNombre, whatsapp?, diaSemana(0=Dom..6=Sáb), horaInicio, horaFin, precio, activo, excepciones[] }`. `TurnoFijoExcepcion { turnoFijoId, fecha @db.Date, @@unique([turnoFijoId,fecha]) }`. Una excepción = ese día el fijo no ocupa el slot (lo libera) — lo usa `ocupacionService`, que alimenta `/disponibilidad` del bot.
- `turnoFijo.routes.ts` (todas `authJwt`): GET, POST, DELETE /:id, **POST /:id/excepciones {fecha}** (`agregarExcepcion`), DELETE /:id/excepciones/:fecha. `turnoFijoService.agregarExcepcion(id, fecha)`.
- El panel `TurnoFijoDialog` **ya captura `whatsapp`** → los fijos nuevos lo tienen; los viejos pueden no tenerlo.
- `utils/tz`: `dayOfWeekInTz(ymd, tz)` → 0=Dom..6=Sáb. `getEnv().TZ_NEGOCIO`.
- Bot (n8n `I8yiX4g1rGh5Hb2U`, Prompt + Cerebro): clasificador Gemini con intents + campos; llega al backend con `x-api-key` (authAny); `fechaLinda` y fechas relativas resueltas.

## Decisiones (confirmadas)
- El bot **libera directo y avisa** (nombrando la fecha liberada), como hace `cancelar`.
- Si el cliente tiene **varios** fijos ese día → libera **todos** (no va ese día). Sin match → avisa que pase por el complejo.
- Sin cambios de frontend (el dialog ya pide whatsapp).

## Alcance

### Backend (Superpowers)

**Nuevo endpoint para el bot:** `POST /turnos-fijos/liberar` (**authAny**, validado), body `{ whatsapp: string(min5), fecha: 'YYYY-MM-DD' }`.
- `turnoFijoService.liberarPorWhatsapp(whatsapp, fecha)`:
  - `dow = dayOfWeekInTz(fecha, TZ_NEGOCIO)`.
  - `fijos = prisma.turnoFijo.findMany({ where: { whatsapp, activo: true, diaSemana: dow } })`.
  - Si `fijos` vacío → `{ liberado: false, cantidad: 0 }`.
  - Para cada fijo, **upsert idempotente** de la excepción (`turnoFijoExcepcion.upsert` por `{turnoFijoId, fecha}` → create vacío/update vacío; no falla si ya existe). `fecha` a `Date` (@db.Date).
  - `{ liberado: true, cantidad: fijos.length }`.
- Ruta registrada como `POST /turnos-fijos/liberar` (path estático, no choca con `/:id/excepciones`). Audita la acción (`auditService.log` con `accion: 'EDITAR', entidad: 'TurnoFijo'`, descripción "Bot liberó la fecha X de un turno fijo").
- Validador `liberarFijoSchema` (body `{ whatsapp: z.string().min(5), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }`, query/params vacíos).
- **No** se cambian las rutas existentes ni la lógica de excepciones del panel.

### Bot (n8n — fuera del plan de código; se aplica con n8n MCP tras el deploy del backend)
- **Prompt (clasificador):** agregar al enum de `intent` el valor **`liberar_fijo`** (con descripción: avisos de que no van a poder ir a su turno fijo, ej. "no vamos a poder ir hoy", "esta semana no vamos el miércoles", "liberá mi turno"). Agregar al `responseSchema` un campo **`recurrente: boolean`** (nullable) e instruir: `recurrente=true` cuando pide algo repetido ("todos los X", "todas las semanas", "fijo", "siempre los X").
- **Cerebro:**
  - **Rama `liberar_fijo`:** resolver `fecha` (`gem.fecha || hoy`); `POST /turnos-fijos/liberar { whatsapp: number, fecha }`. Si `liberado` → "Listo, liberé tu turno fijo del {fechaLinda(fecha)}. ¡Gracias por avisar!"; si no → "No encuentro un turno fijo tuyo para esa fecha. Si lo tenés, pasá por el complejo o escribinos y lo vemos." (envuelto en try/catch como el resto).
  - **Recurrente:** en la rama `reservar`/`consultar_disponibilidad`, si `gem.recurrente === true`, **anteponer** al reply (cuando ya hay día/propone reserva) la aclaración: "Por ahora te reservo el {día} suelto. Para que quede FIJO (todas las semanas) tenés que pasar por el complejo." El flujo de reserva sigue igual (reserva suelta del próximo día que Gemini resolvió). El bot **no** crea el fijo.
- El bot **no** crea ni elimina turnos fijos.

## Datos / flujo
1. "no vamos a poder ir hoy" → intent `liberar_fijo`, fecha=hoy → `POST /turnos-fijos/liberar` → libera el/los fijo(s) de ese whatsapp ese día → confirma. El slot queda disponible para otros en `/disponibilidad`.
2. "quiero todos los miércoles" → intent `reservar`, `recurrente=true`, fecha=próximo miércoles → ofrece esa reserva suelta + nota de "presencial para fijo".

## Manejo de errores / bordes
- Sin match (fijo sin whatsapp cargado, o no tiene fijo ese día) → `liberado:false` → mensaje de "pasá por el complejo". (Los fijos viejos sin whatsapp no se pueden liberar por bot — limitación conocida; se cargan en el panel.)
- Idempotente: liberar dos veces la misma fecha no falla ni duplica.
- `fecha` cuyo weekday no coincide con ningún fijo del cliente → `liberado:false`.
- La liberación NO cancela el fijo (solo esa fecha); el resto de las semanas sigue.

## Pruebas (backend, TDD, Testcontainers)
- `POST /turnos-fijos/liberar` con un fijo del whatsapp en el día correcto → `liberado:true`, y existe la `TurnoFijoExcepcion` para esa fecha.
- Fecha cuyo weekday no matchea el `diaSemana` del fijo → `liberado:false`, sin excepción.
- whatsapp sin fijo → `liberado:false`.
- Idempotente: llamar dos veces → sigue `liberado:true` y una sola excepción (no error).
- (Auth: `authAny` → el bot con `x-api-key` puede; sin auth → 401.)

## Despliegue / compat
- Backend: rama `feat/bot-liberar-fijos` → main + deploy VM (sin migración). Bot: se aplica por n8n MCP **después** del deploy (el endpoint debe existir).
- Aditivo: no toca rutas/lógica existentes.

## Fuera de alcance (YAGNI)
- Crear/eliminar turnos fijos por el bot (presencial).
- "Des-liberar" (volver a tomar una fecha liberada) por el bot.
- Backfill de whatsapp en fijos viejos.
- Notificar al dueño cada liberación (queda en auditoría).
