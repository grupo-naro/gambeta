# Mostrador con cobro (caja tipo POS) — Diseño

**Fecha:** 2026-07-26
**Objetivo:** Convertir el mostrador (buffet) en una caja tipo POS: el operador escanea/agrega
productos a un **carrito**, toca **Cobrar**, ve el **total**, ingresa **con cuánto pagó** y el
sistema muestra el **vuelto**, registrando el **medio de pago** (efectivo o transferencia). Hoy
cada escaneo se registra al instante como una `VentaBuffet`; eso se reemplaza por carrito → cobro.

## Decisiones tomadas

- **Carrito:** en el navegador (transitorio). La venta se persiste y el stock se descuenta recién
  al **Cobrar**. Si se refresca antes de cobrar, se pierde el carrito (aún no se cobró).
- **Pago y vuelto:** EFECTIVO pide `montoPagado` y calcula `vuelto = montoPagado - total`;
  TRANSFERENCIA asume `montoPagado = total` y `vuelto = 0`.
- **Cierre:** separa **total efectivo vs total transferencia** (además del total y el detalle por
  producto).
- **Reemplazo:** se elimina el registro instantáneo por escaneo (`POST /venta`,
  `DELETE /venta/ultima`). El "deshacer" ahora es quitar del carrito (cliente).
- **Pago insuficiente en efectivo** (`montoPagado < total`): es un error, no deja cobrar.
- **Nombres:** `TicketBuffet` = la venta; `VentaBuffet` = línea del ticket (se mantiene el nombre).

## Modelo de datos

Se introduce el ticket (la venta a un cliente) y `VentaBuffet` pasa a ser su línea.

```prisma
model TicketBuffet {
  id          String     @id @default(cuid())
  uid         String     @unique              // idempotencia del cobro
  cajaId      String
  caja        CajaBuffet @relation(fields: [cajaId], references: [id])
  total       Decimal    @db.Decimal(10, 2)
  medioPago   MedioPago
  montoPagado Decimal    @db.Decimal(10, 2)
  vuelto      Decimal    @db.Decimal(10, 2)
  creadoEn    DateTime   @default(now())
  lineas      VentaBuffet[]
  @@index([cajaId])
}

model VentaBuffet {           // línea de ticket
  id         String         @id @default(cuid())
  ticketId   String
  ticket     TicketBuffet   @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  productoId String
  producto   ProductoBuffet @relation(fields: [productoId], references: [id])
  precioUnit Decimal        @db.Decimal(10, 2)
  cantidad   Int            @default(1)
  creadoEn   DateTime       @default(now())
  @@index([ticketId])
}
```

Cambios de relación: `CajaBuffet.ventas` → `CajaBuffet.tickets TicketBuffet[]`. Se le sacan a
`VentaBuffet` los campos `uid` y `cajaId` (ahora viven en el ticket).

**Migración:** reestructura las tablas del buffet (drop `uid`/`cajaId` de `VentaBuffet`, add
`ticketId`/`cantidad`, create `TicketBuffet`). Asume que **no hay ventas de buffet a preservar**
en la demo (el seed no crea ninguna). No se toca `ortigoza/`.

## Flujo (frontend `mostrador`)

1. Escanear (código de barra) o tocar un producto de la botonera → agrega al **carrito**
   (cliente). Mismo producto otra vez → `cantidad++`.
2. El carrito lista `producto × cantidad · subtotal` y el **total** en vivo. Acciones: quitar una
   línea, ajustar cantidad, **vaciar carrito**.
3. **Cobrar** (deshabilitado si el carrito está vacío) → pantalla de cobro:
   - Muestra el **total**.
   - Elegir medio: **Efectivo** o **Transferencia**.
   - Efectivo → input "¿Con cuánto paga?" → muestra el **vuelto** (`pagó - total`); si es menor
     al total, no deja confirmar.
   - Transferencia → sin input de monto (exacto, sin vuelto).
4. **Confirmar** → `POST /buffet/cobrar`. Éxito → muestra total/vuelto/medio, **vacía el carrito**
   y queda listo para el próximo cliente.

El carrito es estado de React; nada se persiste hasta el cobro.

## Backend

- **`POST /buffet/cobrar`** (`authBuffet`), body:
  `{ uid: string, medioPago: 'EFECTIVO'|'TRANSFERENCIA', montoPagado: number, items: [{ productoId, cantidad }] }`.
  - Idempotente por `uid` (si el ticket ya existe, devuelve su resultado sin re-registrar).
  - Requiere caja abierta; `items` no vacío; cada `cantidad` entero positivo.
  - **Recalcula el total en el servidor** con el precio actual de cada producto (no confía en el
    cliente).
  - EFECTIVO: valida `montoPagado ≥ total`; `vuelto = montoPagado - total`.
    TRANSFERENCIA: fuerza `montoPagado = total`, `vuelto = 0`.
  - En una transacción: crea `TicketBuffet` + `VentaBuffet` (una línea por producto con su
    `cantidad`) y **descuenta stock** por `cantidad` (el stock puede quedar negativo, como hoy).
  - Devuelve `{ ticketId, total, vuelto, medioPago }`.
- **Se eliminan** `POST /buffet/venta` y `DELETE /buffet/venta/ultima` (validador `ventaSchema`
  incluido) y su lógica en el service (`vender`, `deshacerUltima`).
- **`GET /buffet/caja/actual`**: recalcula el estado del turno agregando **tickets** en vez de
  ventas sueltas: `totalMonto`, `totalUnidades` (suma de `cantidad`), desglose
  `totalEfectivo`/`totalTransferencia`, y `ultimosTickets` (para que el operador vea lo cobrado).
- **`POST /buffet/caja/cerrar`** y el **cierre** (`CierreDTO`): agregan `totalEfectivo` y
  `totalTransferencia`; `porProducto` se calcula sumando `cantidad`/`precioUnit·cantidad` de las
  líneas de los tickets de la caja.

## Estructura de archivos

- `backend/prisma/schema.prisma` (+ migración).
- `backend/src/services/buffetCaja.service.ts`: reescribir `estadoDe`, `detalleCierre`, `cerrar`;
  quitar `vender`/`deshacerUltima`; agregar `cobrar`.
- `backend/src/validators/buffet.schema.ts`: quitar `ventaSchema`; agregar `cobrarSchema`.
- `backend/src/routes/buffet.routes.ts`: quitar `/venta` y `/venta/ultima`; agregar `/cobrar`.
- `frontend/src/app/mostrador/page.tsx` (+ componentes del mostrador): carrito + pantalla de cobro.
- `frontend/src/app/(panel)/buffet/cierres/page.tsx`: mostrar efectivo vs transferencia.

## Manejo de errores

- Carrito vacío al cobrar → botón deshabilitado (front) + 400 en backend por `items` vacío.
- Efectivo con `montoPagado < total` → error claro, no confirma.
- Producto inexistente/inactivo en `items` → 404/validación; el cobro no se registra (transacción).
- Sin caja abierta → 409 "No hay una caja abierta" (como hoy).
- Reintento del cobro con el mismo `uid` → idempotente, devuelve el mismo ticket.

## Testing

- **Backend (integración, testcontainers):**
  - `cobrar` crea ticket + líneas, descuenta stock por cantidad, calcula total desde precios del
    server.
  - Efectivo: `vuelto` correcto; `montoPagado < total` → error.
  - Transferencia: `montoPagado = total`, `vuelto = 0`.
  - Idempotencia por `uid` (segundo POST no duplica ni re-descuenta).
  - `caja/actual` y `cerrar` reportan `totalEfectivo`/`totalTransferencia` y `porProducto` con
    cantidades.
- **Frontend:** verificación por build/typecheck; el carrito y el cálculo de vuelto son estado de
  React (se pueden cubrir con un test de la función pura de totales/vuelto si se extrae).

## Criterios de éxito

1. Escaneo/tap → carrito con cantidades y total en vivo; quitar/vaciar funciona.
2. Cobrar en efectivo muestra el vuelto correcto y registra la venta; transferencia sin vuelto.
3. El stock se descuenta por cantidad al cobrar (no antes).
4. El cierre separa efectivo y transferencia, con total y detalle por producto.
5. Ya no existe el registro instantáneo por escaneo.

## Fuera de alcance (YAGNI)

- Descuentos/promociones.
- Múltiples cajas en paralelo.
- Otros medios de pago (tarjeta, QR).
- Ticket impreso / reimpresión.
- Carrito persistido en el servidor (ticket pendiente).
