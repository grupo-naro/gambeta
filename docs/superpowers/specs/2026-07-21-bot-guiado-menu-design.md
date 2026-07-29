# Bot guiado por menú (WhatsApp) — Diseño

**Fecha:** 2026-07-21
**Objetivo:** Un bot de WhatsApp **guiado por menú numerado** (sin IA), distinto al bot con IA
de Ortigoza. El cliente escribe cualquier cosa, el bot saluda y ofrece un menú:
`1) Reservar cancha · 2) Ver mis reservas · 3) Modificar mi reserva · 4) Cancelar mi reserva`,
y conduce cada opción paso a paso. Se entrega listo para la demo.

## Decisiones tomadas

- **Reparto de lógica:** n8n fino + cerebro en el backend. n8n solo cablea
  (Evolution → `POST /bot/mensaje` → responder por Evolution). Toda la máquina de estados es
  TypeScript testeable en el backend.
- **Estado de conversación:** en la base de datos (tabla nueva `ConversacionBot`), porque cada
  mensaje dispara una ejecución nueva de n8n (sin memoria entre mensajes).
- **Opciones del menú:** las 4 (reservar, ver, modificar, cancelar).
- **Entrega del workflow n8n:** archivo JSON importable (como los de `canchitas-infra/workflows/`).
- **Infra:** por ahora solo se construye; levantar Evolution/n8n y conectar el número queda para después.
- Las acciones ya existen como servicios/endpoints; el bot los llama **in-process** (no HTTP a sí mismo).

## Arquitectura

```
WhatsApp → Evolution → n8n (workflow fino):
  Webhook recibe { numero, texto }
    → HTTP POST {backend}/bot/mensaje  (header apikey = SERVICE_API_KEY)
    → Evolution sendText { number: numero, text: respuesta }

Backend POST /bot/mensaje { numero, texto } → { respuesta }:
  1. Cargar estado de ConversacionBot[numero] (o INICIO si no existe / si está viejo)
  2. procesarMensaje(estado, texto)  → decide siguiente paso + respuesta + acción opcional
  3. Ejecutar la acción (crear/listar/cancelar/reprogramar) vía los servicios existentes
  4. Guardar el nuevo estado
  5. Devolver { respuesta }
```

### Separación para testeabilidad
- **`bot/flujo.ts` (puro):** funciones de transición por paso. Firma:
  `paso(estado, texto, ctx) → { nuevoEstado, respuesta, accion? }`, donde `ctx` trae los datos
  ya consultados (canchas, slots, reservas, cliente). Sin I/O → 100% unit-testeable.
- **`bot.service.ts` (orquestador):** carga/guarda estado, consulta lo que el paso necesita,
  llama a `flujo`, ejecuta la `accion` con los servicios existentes. Se prueba con integración.
- **Ruta `POST /bot/mensaje`:** `authApiKey`, body `{ numero, texto }` → `{ respuesta }`.

## Modelo de datos

```prisma
model ConversacionBot {
  numero        String   @id            // whatsapp canónico del cliente
  paso          String   @default("INICIO")
  datos         Json     @default("{}") // selecciones parciales + mapeos de listas numeradas
  actualizadoEn DateTime @updatedAt
}
```
`datos` guarda lo recolectado en el flujo y los **mapeos de las listas numeradas** (para traducir
"2" → el id de la 2ª cancha/reserva/slot que se mostró). Ejemplos de claves: `canchaId`, `fecha`,
`horaInicio`, `nombreCliente`, `reservaId`, y listas efímeras `opcionesCanchas: string[]`,
`opcionesSlots: string[]`, `opcionesReservas: string[]`.

**Reset por inactividad:** al cargar, si `actualizadoEn` tiene más de 30 min, se trata como `INICIO`
(la conversación vieja se reinicia). Simple y evita quedar “trabado” en un paso.

## Máquina de estados (pasos, entradas y mensajes)

Comandos globales (en cualquier paso): `menu` o `0` → vuelve a `MENU`. Entrada inválida → se
re-muestra el prompt del paso con una aclaración (no avanza).

### MENU (y arranque)
- Entrada en `INICIO` (o cualquier texto sin sesión) → responde saludo + menú, pasa a `MENU`.
  `NOMBRE_NEGOCIO` es una constante del módulo `flujo` (para la demo: `"Grupo Naro"`); si más
  adelante se quiere configurable, se lee de `config`. Mensaje:
  > ¡Hola! 👋 Soy el asistente de {NOMBRE_NEGOCIO}. Escribí el número de lo que querés hacer:
  > 1) Reservar cancha
  > 2) Ver mis reservas
  > 3) Modificar mi reserva
  > 4) Cancelar mi reserva
- En `MENU`, según el texto:
  - `1` → inicia Reservar (ver RES_CANCHA)
  - `2` → Ver mis reservas (acción directa, vuelve a MENU)
  - `3` → inicia Modificar (MOD_ELEGIR)
  - `4` → inicia Cancelar (CAN_ELEGIR)
  - otro → re-muestra el menú con "No entendí, escribí 1, 2, 3 o 4."

### Opción 2 — Ver mis reservas (single-shot)
- Acción: `reservaService.list({ whatsapp: numero })`, filtrando activas/futuras
  (`CONFIRMADA`/`ESPERANDO_SENA`).
- Respuesta: lista numerada `1) {fecha} {hora} · {cancha} · {estado}`. Si no hay: "No tenés
  reservas activas." Vuelve a `MENU` (agrega "Escribí *menu* para volver al menú.").

### Opción 1 — Reservar cancha
- `RES_CANCHA`: `ctx.canchas = canchaService.list(true)`. Muestra numeradas, guarda
  `opcionesCanchas`. Prompt: "¿Qué cancha? 1) … 2) …". Espera número.
  - válido → guarda `canchaId`, pasa a `RES_FECHA`.
- `RES_FECHA`: prompt "¿Para qué día? Escribí la fecha (dd/mm)." (interpreta `dd/mm` → `YYYY-MM-DD`,
  año actual; si la fecha ya pasó, usa el año próximo). Guarda `fecha`, pasa a `RES_HORA`.
- `RES_HORA`: `ctx.slots = disponibilidadService.listar(canchaId, fecha).slots`. Si vacío:
  "No hay horarios libres ese día." y vuelve a `RES_FECHA`. Si hay: lista numerada de
  `horaInicio`, guarda `opcionesSlots`. Espera número → guarda `horaInicio`.
  - Luego: si `clienteService.buscarPorWhatsapp(numero)` tiene nombre → guarda `nombreCliente` y
    pasa a `RES_CONFIRM`. Si no → `RES_NOMBRE`.
- `RES_NOMBRE`: prompt "¿A nombre de quién?" → guarda `nombreCliente`, pasa a `RES_CONFIRM`.
- `RES_CONFIRM`: muestra resumen "Reservás {cancha} el {fecha} a las {hora} a nombre de
  {nombre}. ¿Confirmás? (sí/no)".
  - `sí` → acción `reservaService.crear({ canchaId, whatsapp: numero, nombreCliente, fecha,
    horaInicio })`. Respuesta de éxito (incluye datos de seña si la config lo pide). Vuelve a `MENU`.
  - `no` → "Reserva cancelada." vuelve a `MENU`.
  - Si `crear` falla (p.ej. horario ocupado / solapamiento): mensaje amable con el motivo y
    vuelve a `RES_HORA` (re-muestra horarios).

### Opción 3 — Modificar mi reserva (reprogramar)
- `MOD_ELEGIR`: `ctx.reservas = reservaService.list({ whatsapp: numero })` (activas/futuras).
  Si no hay → mensaje + `MENU`. Si hay: lista numerada, guarda `opcionesReservas`. Espera número
  → guarda `reservaId`, pasa a `MOD_FECHA`.
- `MOD_FECHA`: "¿Nuevo día? (dd/mm)" → guarda `fecha`, pasa a `MOD_HORA`.
- `MOD_HORA`: `disponibilidadService.listar(canchaDeLaReserva, fecha)` → lista slots. Espera
  número → guarda `horaInicio`, pasa a `MOD_CONFIRM`.
- `MOD_CONFIRM`: resumen "Mover tu reserva al {fecha} {hora}. ¿Confirmás? (sí/no)".
  - `sí` → `reservaService.reprogramar(reservaId, {}, { fecha, horaInicio })`. Éxito → `MENU`.
  - `no` → `MENU`. Error → mensaje + vuelve a `MOD_HORA`.

### Opción 4 — Cancelar mi reserva
- `CAN_ELEGIR`: igual que MOD_ELEGIR (lista activas/futuras). Espera número → guarda
  `reservaId`, pasa a `CAN_CONFIRM`.
- `CAN_CONFIRM`: "¿Seguro que cancelás {fecha} {hora} · {cancha}? (sí/no)".
  - `sí` → `reservaService.cancelar(reservaId, {})`. Éxito → `MENU`.
  - `no` → `MENU`. Error → mensaje + `MENU`.

## Endpoints y servicios usados

| Uso | Servicio (in-process) |
|---|---|
| Listar canchas activas | `canchaService.list(true)` |
| Disponibilidad | `disponibilidadService.listar(canchaId, fecha)` |
| Crear reserva | `reservaService.crear({ canchaId, whatsapp, nombreCliente, fecha, horaInicio })` |
| Mis reservas | `reservaService.list({ whatsapp })` |
| Reprogramar | `reservaService.reprogramar(id, {}, { fecha, horaInicio })` |
| Cancelar | `reservaService.cancelar(id, {})` |
| Nombre del cliente | `clienteService.buscarPorWhatsapp(whatsapp)` |

**Nuevo en el backend:** modelo `ConversacionBot`, repo, `bot/flujo.ts` (puro), `bot.service.ts`,
ruta `POST /bot/mensaje` (`authApiKey`). Nada de las acciones se reimplementa.

## Workflow n8n (entregable JSON)

Archivo `canchitas-infra/workflows/canchitas-bot-guiado.json`. 3 nodos:
1. **Webhook / trigger de Evolution:** extrae `numero` (remoteJid normalizado) y `texto` del
   payload entrante.
2. **HTTP Request:** `POST {BACKEND_URL}/bot/mensaje`, header `apikey: {SERVICE_API_KEY}`,
   body `{ numero, texto }`.
3. **HTTP Request (Evolution sendText):** `{ number: numero, text: {{respuesta}} }`.

Se modela sobre `canchitas-echo.json` / `canchitas-bot-v2.json` para el formato exacto de nodos.
Como es un pasa-manos fino, no lleva lógica de negocio.

## Manejo de errores

- Entrada inválida (no es un número esperado / no es sí/no): re-muestra el prompt del paso con
  aclaración, no avanza.
- Listas vacías (sin canchas / sin slots / sin reservas): mensaje claro y ruta sensata (MENU o
  el paso anterior).
- Error de un servicio (solapamiento, reserva no cancelable por anticipación, etc.): se captura,
  se responde el motivo de forma amable y se vuelve a un paso seguro.
- `evolutionService.enviarWhatsapp` ya es best-effort (nunca lanza); acá el envío lo hace n8n.
- Comando global `menu`/`0` siempre resetea a `MENU`.

## Testing

- **`bot/flujo.ts` (puro):** unit tests por transición — para cada paso, dado
  `(estado, texto, ctx)`, se verifica `nuevoEstado` y `respuesta` (incluye caminos inválidos y
  globales). Es el grueso de la cobertura.
- **`bot.service` / `POST /bot/mensaje` (integración con testcontainers):** simular conversaciones
  completas enviando una secuencia de mensajes y verificando las respuestas y los efectos
  (p.ej. que una reserva quede creada; que "ver mis reservas" la liste; que cancelar la cancele).
- **Workflow n8n:** no se testea automáticamente (pasa-manos fino); se valida importándolo.

## Criterios de éxito

1. Un mensaje cualquiera devuelve saludo + menú.
2. Opción 2 lista las reservas del número (o "no tenés reservas").
3. Opción 1 completa una reserva de punta a punta y queda visible en el panel.
4. Opción 3 reprograma y opción 4 cancela una reserva existente.
5. Entradas inválidas y `menu`/`0` se comportan como se especifica; el estado sobrevive entre
   mensajes (está en la base).

## Fuera de alcance (YAGNI)

- IA / lenguaje natural (es guiado por número, a propósito).
- Pagos/seña dentro del bot más allá de informar los datos que ya devuelve `crear`.
- Reprogramar cambiando de cancha (solo día/hora; se puede sumar después).
- Multi-idioma, adjuntos, botones interactivos de WhatsApp (solo texto numerado).

## Decomposición sugerida para el plan

Aunque el diseño es completo, el plan puede implementarse por fases testeables:
1. Modelo `ConversacionBot` + repo + ruta `POST /bot/mensaje` + `flujo` MENU + opción 2 (ver).
2. Flujo Reservar (RES_*).
3. Flujos Modificar y Cancelar (MOD_*, CAN_*).
4. Workflow n8n JSON + doc de importación.
