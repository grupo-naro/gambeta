# Mercado Pago — pago de la seña (Sub-proyecto B) — Diseño

**Fecha:** 2026-07-28
**Objetivo:** En la web de reservas (`reservas/`), cuando una reserva queda `ESPERANDO_SENA`, en
vez de solo informar el alias/CBU, redirigir al cliente a **Mercado Pago (Checkout Pro, sandbox)**
para pagar la seña. Un webhook confirma el pago y la reserva pasa a `CONFIRMADA` automáticamente,
sin intervención del admin.

## Decisiones tomadas

- **Checkout Pro**: se crea una *preferencia de pago* y se redirige al cliente a la página alojada
  por Mercado Pago. Sin formulario de tarjeta propio.
- **Al confirmarse el pago (webhook)**: la reserva pasa a `CONFIRMADA` sola (reusando la lógica de
  `aprobarSena`), igual que hoy hace el bot/admin.
- **La web deja de ofrecer transferencia manual**: siempre redirige a Mercado Pago. La
  transferencia (alias/CBU) queda solo para el bot/panel, que no cambian.
- **Credenciales**: de **prueba (sandbox)**, de la aplicación `canchas-dev` ya creada en Mercado
  Pago. Se usa el **SDK oficial de Node** (`mercadopago`), no llamadas HTTP a mano.
- **Pago abandonado/rechazado**: la web muestra una pantalla clara de "no se completó el pago",
  con botón para **reintentar** (genera una preferencia nueva) y datos de contacto; la reserva
  queda `ESPERANDO_SENA`.

## Backend

### Dependencia
`npm install mercadopago` (SDK oficial). Se usa:
- `new MercadoPagoConfig({ accessToken })`
- `new Preference(client).create({ body })` → crear la preferencia.
- `new Payment(client).get({ id })` → consultar un pago por id.
- `WebhookSignatureValidator.validate({ xSignature, xRequestId, dataId, secret })` (lanza
  `InvalidWebhookSignatureError` si la firma no es válida) → valida el webhook.

### Config (env, `backend/src/config/env.ts`)
- `MP_ACCESS_TOKEN: z.string().default('')` — access token (sandbox `TEST-...` para la demo).
- `MP_WEBHOOK_SECRET: z.string().default('')` — clave para validar la firma (se obtiene al
  registrar el webhook: "Tus integraciones" → app → **Webhooks → Configurar notificación**).
- `RESERVAS_PUBLIC_URL: z.string().default('')` — dominio público de la web de reservas, para las
  `back_urls`.
- `BACKEND_PUBLIC_URL: z.string().default('')` — dominio público del backend, para el
  `notification_url` del webhook.

Si `MP_ACCESS_TOKEN` o `RESERVAS_PUBLIC_URL` faltan al intentar crear una preferencia, el service
lanza `Conflict('Mercado Pago no está configurado')` (error claro, no crash).

### Modelo `Pago` (migración)
Se agregan dos columnas nullable:
```prisma
model Pago {
  // ...campos existentes...
  mpPreferenceId String?
  mpPaymentId    String?
}
```

### `mercadoPago.service.ts` (nuevo)
- `crearPreferencia(reserva: { id; monto: montoSena; clienteNombre })`:
  ```ts
  {
    items: [{ title: `Seña reserva ${cancha}`, quantity: 1, unit_price: montoSena, currency_id: 'ARS' }],
    back_urls: {
      success: `${RESERVAS_PUBLIC_URL}/reservar/pago/exito?external_reference=${reservaId}`,
      pending: `${RESERVAS_PUBLIC_URL}/reservar/pago/pendiente?external_reference=${reservaId}`,
      failure: `${RESERVAS_PUBLIC_URL}/reservar/pago/pendiente?external_reference=${reservaId}`,
    },
    auto_return: 'approved',
    external_reference: reservaId,
    notification_url: `${BACKEND_PUBLIC_URL}/webhooks/mercadopago`,
  }
  ```
  Guarda `mpPreferenceId` en el `Pago` de la reserva (upsert). Devuelve `{ checkoutUrl }` usando
  `sandbox_init_point` de la respuesta (credenciales de prueba).
- `obtenerPago(paymentId)`: `Payment.get({ id })` → `{ id, status, external_reference,
  transaction_amount }`.
- `verificarFirma({ xSignature, xRequestId, dataId })`: usa `WebhookSignatureValidator` con
  `MP_WEBHOOK_SECRET`; devuelve `true`/`false` (no lanza — el handler decide qué responder).

### Rutas nuevas
- **`POST /pagos/mercadopago/preferencia`** `{ reservaId }` (mismo tipo de auth que ya usan las
  rutas que llama la web — `authAny`, con `SERVICE_API_KEY`): busca la reserva, valida que esté
  `ESPERANDO_SENA`, crea la preferencia → `{ checkoutUrl }`.
- **`POST /webhooks/mercadopago`** (público, **sin** `authAny` — Mercado Pago no manda esas
  credenciales; se protege únicamente con la firma):
  1. Extrae `dataId` de `req.query['data.id']` (o `req.body?.data?.id` si falta en la query) y
     `type`/`topic` (solo procesa `payment`; cualquier otro tópico responde 200 sin hacer nada).
  2. Valida la firma con `verificarFirma`. Si es inválida → **401** (no se procesa).
  3. Consulta el pago (`obtenerPago`). Si `status !== 'approved'` → **200**, no hace nada (queda
     para un próximo webhook o el cliente reintenta).
  4. Si está aprobado: busca la reserva por `external_reference`. Si no existe, o si ya **no**
     está `ESPERANDO_SENA` (reintento de MP, doble webhook) → **200**, no reprocesa (idempotente).
  5. Si corresponde: llama `reservaService.aprobarSena(reservaId, {}, { montoDetectado:
     transaction_amount })` (reusa la lógica existente: transacciona, crea `Cobro`, pasa la
     reserva a `CONFIRMADA`). Guarda `mpPaymentId` en el `Pago`. Envía el aviso de WhatsApp al
     cliente (reusa `mensajeSenaAprobada` + `evolutionService`, best-effort, igual patrón que la
     aprobación manual del admin).
  6. Responde **200** siempre que el procesamiento no falle por error interno (en cuyo caso 500,
     para que MP reintente).

## Web `reservas/`

- **Nueva server action** `crearPreferenciaPago(reservaId)` → `POST
  /pagos/mercadopago/preferencia` → `Resultado<{ checkoutUrl: string }>`.
- **`confirmar()`** en `pantalla-reserva.tsx`: tras `crearReserva` exitoso, si
  `montoSena != null && montoSena > 0` → llama `crearPreferenciaPago(id)`:
  - éxito → `window.location.href = checkoutUrl` (redirige a Mercado Pago).
  - error → se queda en la pantalla de confirmación mostrando que la reserva quedó registrada,
    pero avisando que no se pudo generar el link de pago (mensaje de contacto), en vez de dejar
    al cliente sin salida.
  - Si `montoSena` es `null`/`0` (cliente de confianza, sin seña) → sigue como hoy, sin Mercado
    Pago.
- **Páginas nuevas**:
  - `reservas/src/app/reservar/pago/exito/page.tsx`: mensaje de éxito ("¡gracias! estamos
    confirmando tu pago").
  - `reservas/src/app/reservar/pago/pendiente/page.tsx`: mensaje de "no se completó el pago" +
    botón **reintentar** (lee `external_reference` de la URL, vuelve a llamar
    `crearPreferenciaPago` y redirige de nuevo) + datos de contacto. Sirve tanto para `pending`
    como para `failure` (misma pantalla).
- `.env.example` de `reservas/` no cambia (sigue usando `API_URL`/`SERVICE_API_KEY`; MP vive del
  lado del backend).

## Testing

- **Backend (integración, testcontainers):**
  - `POST /pagos/mercadopago/preferencia`: reserva inexistente → 404; reserva no
    `ESPERANDO_SENA` → 409/422; éxito → guarda `mpPreferenceId` y devuelve `checkoutUrl` (mockear
    la llamada al SDK de Mercado Pago, sin red real).
  - `POST /webhooks/mercadopago`: firma inválida → 401 y no cambia nada; pago aprobado con
    reserva `ESPERANDO_SENA` → pasa a `CONFIRMADA`, crea `Cobro`, guarda `mpPaymentId`; pago
    aprobado pero reserva ya `CONFIRMADA` (reintento) → 200 sin duplicar nada; pago no aprobado
    → 200 sin cambios.
- **Frontend:** `reservas/` sin runner de tests; verificación por `pnpm build`.

## Criterios de éxito

1. Al confirmar una reserva con seña > 0, la web redirige a Mercado Pago (sandbox).
2. Pagando con una tarjeta/cuenta de prueba, la reserva pasa sola a `CONFIRMADA` (webhook) y el
   cliente recibe el aviso por WhatsApp.
3. Un pago rechazado/abandonado deja la reserva `ESPERANDO_SENA` y la web ofrece reintentar.
4. Webhooks con firma inválida se rechazan (401) y no alteran ninguna reserva.
5. Reintentos del mismo webhook (MP puede reenviar) no duplican `Cobro` ni rompen la reserva.

## Fuera de alcance (YAGNI)

- Transferencia manual en la web (se elimina de ahí; sigue existiendo en bot/panel).
- Reembolsos, contracargos, cancelaciones de pago.
- Credenciales de producción (queda en sandbox).
- Guardar tarjeta / pagos recurrentes.
- Crear los usuarios de prueba (comprador/vendedor) y registrar el webhook en Mercado Pago: se
  hacen con las tools del MCP (`create_test_user`, `save_webhook`) como parte de la
  implementación/pruebas, no en el diseño.
