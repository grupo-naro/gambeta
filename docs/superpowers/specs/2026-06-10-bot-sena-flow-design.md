# Spec — Flujo de seña en el bot de WhatsApp (n8n)

- **Fecha:** 2026-06-10
- **Componente:** workflow n8n `Canchitas — Bot v2` (`I8yiX4g1rGh5Hb2U`). Backend ya provee todo.
- **Estado:** Aprobado.

## Objetivo
1. Al crear una reserva `ESPERANDO_SENA`, el bot envía los datos de pago (CBU/alias/titular) + monto y
   pide el comprobante.
2. Al recibir la imagen del comprobante, el bot la verifica con Gemini Vision y aprueba la seña
   automáticamente si coincide, o escala a un admin por WhatsApp.

## Decisiones
- **Escalado:** a un número admin por WhatsApp → `5491159582039`.
- **Auto-aprobar si:** `es_comprobante_valido` Y `monto >= montoSena` Y (alias **o** CBU coincide con el
  del negocio).
- **Tolerancia de monto:** exacto o más (pagar de más = ok; pagar de menos = no).

## Parte A — Enviar CBU/monto (rama "confirmar" del Cerebro)
`POST /reservas` ya devuelve `montoSena` + `datosPago {cbu, alias, titular}` en ESPERANDO_SENA.
El Cerebro, al confirmar una reserva nueva (ESPERANDO_SENA), responde con los datos de transferencia
y pide la foto del comprobante. Guarda en Redis: `{ esperaComprobante:true, resId, montoSena, alias,
cbu, label }`. (Para CONFIRMADA — contacto — sigue igual: "¡Listo, reservado!").

## Parte B — Verificar comprobante (rama imagen)
- **Extraer:** detectar `data.message.imageMessage` → `esImagen:true` + datos para obtener la imagen.
- **Evolution webhook:** `webhookBase64=true` para que la imagen llegue como base64 en el webhook
  (evita un fetch extra). Confirmar en qué campo del payload queda el base64 (inspección con imagen real).
- **Cerebro (rama imagen):**
  1. Leer Redis. Sin `esperaComprobante` → "no tengo una reserva tuya esperando seña".
  2. Gemini Vision (`gemini-2.5-flash`, inline image) → JSON `{ monto, alias_destino, cbu_destino,
     es_comprobante_valido }`.
  3. Comparar contra lo guardado en Redis (montoSena/alias/cbu).
     - OK → `PATCH /reservas/:id/aprobar-sena` (body `{montoDetectado}`) → "¡Seña recibida, turno
       CONFIRMADO!" + limpiar Redis.
     - No OK / ilegible → enviar al admin (`5491159582039`) el comprobante + resumen (cliente, monto
       detectado vs esperado, motivo) y al cliente "no pude verificarlo, lo revisa un encargado".
       No limpia Redis (el timeout de 30min lo cancela si nadie actúa).
- El aviso al admin se hace dentro del Cerebro (`helpers.httpRequest` → Evolution); el `Enviar` final
  responde al cliente.

## Arquitectura
Sin cambios de grafo: Webhook→Extraer→Leer contexto→Prompt→Cerebro→Guardar contexto→Enviar. El
Cerebro ramifica internamente (texto vs imagen). Mantiene el fallback try/catch existente.

## Errores / constraints
- Imagen sin reserva pendiente → mensaje aclaratorio.
- Falla de Vision/Evolution → fallback "demora técnica" (ya existe).
- **Cuota Gemini:** cada comprobante = 1 llamada Vision (de las 20/día gratis). Testeo limitado.

## Verificación (no es código con tests; es n8n en vivo)
- `validate_workflow` + ejecuciones reales (inspección con `n8n_executions`).
- Parte A: turno "sí" de cliente nuevo → respuesta con CBU/monto (1 call Gemini texto).
- Parte B: enviar una foto de comprobante real → aprobación o escalado (1 call Vision).

## Fuera de alcance
- Panel admin para aprobar/rechazar (el admin recibe el aviso por WhatsApp; aprobación manual vía panel
  es futuro). Por ahora el admin ve el comprobante y, si quiere forzar, se hace desde el backend/panel.
