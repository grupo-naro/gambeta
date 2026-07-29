# Aviso automático al cliente cuando el admin aprueba la seña — Design

**Fecha:** 2026-07-13
**Estado:** CERRADO — listo para writing-plans.

## Problema / pedido

Cuando el bot **no puede verificar el comprobante automáticamente**, deriva la reserva al admin para aprobación manual. Hoy, cuando el admin aprueba la seña desde el panel, **el cliente no se entera** de que su turno quedó confirmado. Queremos que, al aprobar la seña en el panel, el bot le avise automáticamente al cliente por WhatsApp que la seña fue aprobada y el turno quedó confirmado.

## Contexto del código actual (verificado)

- `reservaService.aprobarSena(id, by, detalle)` (`src/services/reserva.service.ts`) transiciona la reserva a `CONFIRMADA` (pago `APROBADO`, cobro, audit, marca la hoja sucia). Lo llama `PATCH /reservas/:id/aprobar-sena` (`authAny`).
- **Lo llaman DOS actores:** el admin desde el panel (con `by.adminId`) y el bot cuando verifica solo (sin `adminId`, `verificadoPor: 'IA'`).
- La reserva (`reservaService.get(id)` → `findById`) ya incluye `cliente` (con `whatsapp`), `cancha` (con `nombre`) y `fechaInicio`.
- **El backend NO habla con Evolution hoy** — solo el bot (n8n). Pero el backend corre en la misma red Docker (`canchitas-network`) y puede llegar a Evolution en `http://evolution:8080`.
- El bot manda mensajes con: `POST {EVOLUTION_URL}/message/sendText/{INSTANCIA}`, header `apikey: <key>`, body `{ number, text }`. El `number` son los dígitos del WhatsApp (formato `549…`, tal como está guardado en `cliente.whatsapp`).
- `fetch` nativo disponible (Node 24). Logger: `logger` de `src/utils/logger.js` (pino). Env: `getEnv()` de `src/config/env.js`. TZ del negocio: `getEnv().TZ_NEGOCIO`.

## Decisión central

El aviso se envía **únicamente cuando la aprobación es manual del admin** (`by.adminId` presente). Cuando aprueba el bot (auto-verificación, sin `adminId`), **NO** se envía desde el backend, porque el bot ya le avisa al cliente por su propio flujo. Así se evita el doble mensaje.

## Arquitectura (enfoque A elegido)

El backend le habla a Evolution directamente. Enfoque descartado (B): pasar por un webhook de n8n — agrega un salto de red, un workflow nuevo que mantener, y hace que un click del panel dependa de que n8n esté prendido. Para un mensaje fijo de confirmación, el envío directo es más simple y robusto.

**Nuevo componente:** `src/services/evolution.service.ts`
- `enviarWhatsapp(number: string, text: string): Promise<boolean>` — hace `POST {EVOLUTION_URL}/message/sendText/{EVOLUTION_INSTANCE}` con header `apikey: EVOLUTION_API_KEY` y body `{ number, text }`, usando `fetch`.
- **Best-effort:** envuelto en try/catch; nunca lanza. Si falta `EVOLUTION_API_KEY` o `EVOLUTION_INSTANCE`, no intenta enviar (retorna `false`) y loguea un `warn` con `logger`. Ante error de red / respuesta no-2xx, loguea `warn`/`error` y retorna `false`. Devuelve `true` solo si el envío fue 2xx.

**Env nuevas (opcionales)** en `src/config/env.ts`:
- `EVOLUTION_URL` — `z.string().default('http://evolution:8080')`
- `EVOLUTION_API_KEY` — `z.string().default('')`
- `EVOLUTION_INSTANCE` — `z.string().default('')`
Opcionales para que el backend arranque igual si faltan (falla cerrada localizada: no se manda el aviso, pero nada se rompe), consistente con cómo se manejó `BUFFET_API_KEY`.

**Cambio en `aprobarSena`:** después de la transacción (que ya deja la reserva CONFIRMADA), **si `by.adminId`**, construir el mensaje y llamar `evolutionService.enviarWhatsapp(r.cliente.whatsapp, mensaje)` **sin `await` que pueda romper** — en realidad se `await`ea pero está envuelto para nunca propagar error (best-effort). El valor de retorno de `aprobarSena` no cambia (sigue devolviendo la reserva actualizada). El envío ocurre después del commit, nunca dentro de la transacción.

## Mensaje

> ¡Listo! Confirmamos tu seña ✅. Tu turno de {cancha} el {díaLindo} a las {hora} quedó reservado. ¡Te esperamos!

- `{cancha}` = `r.cancha.nombre`.
- `{hora}` = hora de `r.fechaInicio` en `TZ_NEGOCIO`, formato `HH:MM` (`toLocaleTimeString('es-AR', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false })`).
- `{díaLindo}` = fecha de `r.fechaInicio` en `TZ_NEGOCIO`. Formato amistoso: si es hoy → "hoy"; si es mañana → "mañana"; si no → nombre del día + `DD/MM` (ej. "el jueves 16/07"). Se puede implementar con un helper chico en el propio service o en `src/utils/tz.ts`.

## Flujo de datos

1. Cliente manda comprobante → el bot no puede verificar → deriva al admin (ya existe).
2. Admin abre el panel y aprueba la seña → `PATCH /reservas/:id/aprobar-sena` con JWT admin → `aprobarSena(id, { adminId }, detalle)`.
3. Transacción: pago APROBADO, reserva CONFIRMADA, cobro, audit (ya existe).
4. **NUEVO:** post-commit, si `by.adminId`, envío best-effort del WhatsApp de confirmación al `cliente.whatsapp`.
5. El cliente recibe "seña confirmada, turno reservado".

## Manejo de errores

- El envío es **best-effort y no bloqueante del resultado**: cualquier fallo (Evolution caído, timeout, config faltante, número inválido) se captura y se loguea; `aprobarSena` **igual devuelve la reserva CONFIRMADA**. La fuente de verdad es la reserva en la base, no el mensaje.
- Nunca se reintenta dentro de la request (si falla, el admin ve la aprobación exitosa igual; puede avisar a mano si hace falta).

## Testing

Tests de integración (Vitest + Supertest + Postgres en Docker), inyectando/espiando el envío para no depender de Evolution real:
- **Aprobación manual (con `adminId`)** → se intenta el envío UNA vez, al `whatsapp` del cliente, con un texto que contiene el nombre de la cancha y la hora. La reserva queda CONFIRMADA.
- **Aprobación del bot (sin `adminId`)** → **NO** se intenta ningún envío. La reserva queda CONFIRMADA.
- **Evolution falla / sin `EVOLUTION_API_KEY`** → `aprobarSena` igual devuelve CONFIRMADA (best-effort, no rompe).

Mecanismo de test: `enviarWhatsapp` debe ser espiable/inyectable. Opción simple: por defecto (sin `EVOLUTION_API_KEY` en el entorno de test) el service no envía y retorna `false`; para el test de "se intenta el envío en aprobación manual", espiar la función `enviarWhatsapp` del módulo (o inyectar un doble) y verificar que fue llamada con el número del cliente y un texto correcto. El plan define el mecanismo exacto de espía.

## Integración / deploy

- Backend: rama feature → merge a `main` (sin push, regla vigente) — el usuario pushea.
- Env nuevas en la VM: `EVOLUTION_API_KEY` y `EVOLUTION_INSTANCE` con los valores reales de Evolution (los mismos que usa el bot en n8n). `EVOLUTION_URL` puede quedar en el default `http://evolution:8080`. Si no se cargan, el aviso no se manda pero nada más se rompe.
- No requiere cambios en el frontend ni en el bot (n8n).

## Fuera de alcance

- Aviso al RECHAZAR la seña (decidido: solo aprobación).
- Cualquier otro aviso automático (recordatorios, reprogramaciones, etc.).
- Reintentos / cola de mensajes fallidos.
