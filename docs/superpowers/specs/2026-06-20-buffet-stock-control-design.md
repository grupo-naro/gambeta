# Control de stock del buffet (lector de código de barras + botonera) — Design

**Fecha:** 2026-06-20 · **Cerrado:** 2026-07-10
**Estado:** CERRADO — listo para writing-plans.

## Problema / pedido del cliente

El complejo tiene un buffet. Quieren **controlar lo que se vendió** y el stock, NO un POS/facturación. Al **cerrar la caja** el dueño quiere saber cuánto se vendió en el turno.

Los productos con envase (bebidas, galletitas) tienen código de barras. Los preparados (agua caliente, pancho, sanguche) no.

**Restricción de usabilidad, la más importante del proyecto:** el buffet lo atienden **personas mayores**. La pantalla del mostrador tiene que ser una sola, sin menús, con texto y botones grandes. Cualquier decisión de diseño se resuelve a favor de la simplicidad de esa pantalla.

## Decisiones cerradas con el usuario

| Tema | Decisión | Fecha |
|---|---|---|
| Hardware del mostrador | **Hay PC/tablet con internet estable** → escenario A1 | 2026-07-10 |
| Productos sin código | **Botones grandes con el nombre**, no códigos `01`/`02` tecleados | 2026-07-10 |
| Medio de pago | **No se distingue.** Solo el total. YAGNI | 2026-07-10 |
| Cierre de caja | **Solo muestra lo vendido.** No se declara el efectivo contado | 2026-07-10 |
| Unidad de venta | Cada escaneo/toque = **1 unidad** | 2026-06-20 |
| Stock en 0 | **No bloquea la venta.** Puede quedar negativo | 2026-06-20 |
| Precio | **Congelado** en cada venta | 2026-06-20 |
| Alcance | Una sola feature → un spec, un plan | 2026-07-10 |

## Arquitectura

Tres piezas con un límite claro entre ellas. Reusa el backend `.36` y el panel de Vercel; no hay infra nueva.

1. **Backend (`.36`)** — módulo `buffet`: modelos Prisma + `buffet.service.ts` + `buffet.routes.ts`.
2. **Mostrador** — ruta `/mostrador` en el panel de Vercel, fuera del grupo `(panel)`, pantalla completa, sin sidebar.
3. **Admin** — sección "Buffet" dentro de `(panel)`, con el auth de admin que ya existe.

### Autenticación (dos caminos separados)

Las rutas del **mostrador** (abrir caja, vender, deshacer, cerrar) van detrás de un middleware nuevo `authBuffet`, que valida el header `x-buffet-key` contra la env `BUFFET_API_KEY`. Se calca de `src/utils/serviceAuth.ts`: comparación timing-safe, soporte de rotación. **Llave separada y de menor privilegio** que `SERVICE_API_KEY`: si se filtra la del mostrador, no toca reservas ni clientes.

Las rutas de **admin** (catálogo, stock, reportes) usan el `authJwt` existente.

### El PIN del mostrador

`src/middleware.ts` del panel intercepta **todas** las rutas (`matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.).*)']`) y redirige a `/login` a cualquiera sin JWT de admin. **Hay que exceptuar `/mostrador` en ese matcher**, o la ruta es inalcanzable.

- `/mostrador` se gatea con su propia cookie httpOnly. Sin cookie válida → `/mostrador/pin`.
- `/mostrador/pin` es un **server action**: recibe los 4 dígitos, los compara con bcrypt (ya es dependencia del backend) contra un hash guardado en `Configuracion`, y setea la cookie.
- Un `buffetFetch` **server-only**, hermano de `src/lib/api.ts`, llama al backend con `BUFFET_API_KEY` desde el entorno del servidor de Next.

**Ni el PIN ni la llave llegan nunca al navegador.** El hash va en `Configuracion` (no en una env var) para que el dueño pueda cambiar el PIN desde el panel sin redeploy.

## Modelos de datos (nuevos)

```prisma
model ProductoBuffet {
  id          String   @id @default(cuid())
  nombre      String
  codigoBarra String?  @unique   // null = producto preparado, sin envase
  precio      Decimal  @db.Decimal(10, 2)
  stock       Int      @default(0)
  stockMinimo Int      @default(0)
  enBotonera  Boolean  @default(false)
  orden       Int      @default(0)
  activo      Boolean  @default(true)
  ventas      VentaBuffet[]
}

model CajaBuffet {
  id            String    @id @default(cuid())
  abiertaEn     DateTime  @default(now())
  cerradaEn     DateTime?
  estado        EstadoCajaBuffet @default(ABIERTA)
  totalUnidades Int?      // snapshot al cerrar
  totalMonto    Decimal?  @db.Decimal(10, 2)
  ventas        VentaBuffet[]
}

model VentaBuffet {
  id         String   @id @default(cuid())
  uid        String   @unique   // idempotencia: lo genera el mostrador
  cajaId     String
  caja       CajaBuffet @relation(fields: [cajaId], references: [id])
  productoId String
  producto   ProductoBuffet @relation(fields: [productoId], references: [id])
  precioUnit Decimal  @db.Decimal(10, 2)  // congelado
  creadoEn   DateTime @default(now())
}

enum EstadoCajaBuffet { ABIERTA CERRADA }
```

`codigoBarra` es único y nullable: Postgres admite muchos `NULL` en una columna única, así que varios preparados sin código no colisionan.

**`uid`** no estaba en el borrador y es necesario: si el wifi hipa y el navegador reintenta el POST, el backend reconoce el `uid` repetido y devuelve la venta existente sin duplicarla. Sin eso, un reintento fantasma suma plata al cierre y descuenta stock, y nadie se entera.

`Configuracion` suma un campo: `buffetPinHash String @default("")`.

## Endpoints

**Mostrador** (`authBuffet`):
- `POST /buffet/caja/abrir` → devuelve la caja ABIERTA; si ya hay una, **la reusa** (no falla).
- `GET  /buffet/caja/actual` → caja abierta + total acumulado + últimas ventas.
- `POST /buffet/venta` `{ uid, codigoBarra? , productoId? }` → crea venta, descuenta stock. `uid` repetido → 200 con la venta existente.
- `DELETE /buffet/venta/ultima` → borra la última venta de la caja abierta y repone el stock.
- `POST /buffet/caja/cerrar` → marca CERRADA, calcula y congela `totalUnidades` + `totalMonto`, devuelve el resumen por producto.
- `GET  /buffet/productos/botonera` → productos activos con `enBotonera`, ordenados.

**Admin** (`authJwt`):
- `GET/POST/PATCH /buffet/productos` — catálogo.
- `POST /buffet/productos/:id/reponer` `{ cantidad }` — suma stock.
- `GET /buffet/cajas` — cierres, con detalle por producto.

## Pantalla del mostrador

Una sola pantalla. Arriba, grande, el **total acumulado del turno**. Abajo, la **grilla de botones** de los productos con `enBotonera`. Y un `input` invisible que **siempre tiene el foco**: ahí "tipea" el lector (es un teclado USB/BT que emite el código + Enter).

**El detalle que hace que esto funcione o no:** cada vez que alguien toca un botón, el navegador le saca el foco al input y el siguiente escaneo se pierde. Se resuelve con `onMouseDown` + `preventDefault` en los botones (no roban el foco) más un re-enfoque defensivo al detectar `blur`. Es la parte más frágil y la que hay que **probar a mano con el lector real**.

Flujo:
1. Abrir la app → PIN una vez (queda la cookie en el dispositivo).
2. **Abrir caja**. Si no hay caja abierta, la pantalla muestra un botón grande "Abrir caja" en lugar de un error.
3. **Vender**: escanear o tocar un botón. Cada venta se **persiste al instante**; si se corta la luz, no se pierde nada. Feedback grande: `Coca 500 ml — $1.500` y el total actualizado.
4. **Deshacer último**: botón grande, borra la venta y repone stock.
5. **Cerrar caja**: pide confirmación (única acción irreversible) y muestra el resumen.

Código desconocido → cartel rojo *"Producto no cargado"*, no registra nada, suma al contador de no reconocidos del turno.

## Admin (panel Vercel) — sección "Buffet"

- **Productos:** alta/edición (nombre, precio, stock mínimo, código de barras, `enBotonera`, `orden`). El dueño puede cargar el código escaneándolo desde su PC: el lector es un teclado y el campo es un input común.
- **Stock:** stock actual, con los productos bajo mínimo (`stock <= stockMinimo`) destacados arriba. Botón "Reponer" que suma mercadería entrante.
- **Cierres:** lista de cajas cerradas (fecha, unidades, total) + detalle por producto.

Reposiciones y cambios de precio se registran en el **`AuditLog` existente**. No se crea una tabla de movimientos de stock.

## Errores y bordes

| Situación | Comportamiento |
|---|---|
| Vender sin caja abierta | 409; la pantalla muestra "Abrir caja" |
| Abrir caja con una ya abierta | Reusa la abierta (no falla) |
| Cerrar una caja ya cerrada | 409 |
| `uid` repetido | 200 con la venta existente; no duplica ni descuenta |
| Código de barras desconocido | No registra; cartel rojo + contador de no reconocidos |
| Stock llega a 0 | **Se permite negativo.** No traba el mostrador |
| Producto inactivo | No se vende ni aparece en la botonera |
| Doble escaneo accidental | "Deshacer último" |

El stock negativo es deliberado: el conteo real siempre está desfasado, y trabar el mostrador un sábado a la noche es peor que un número feo. La alerta de bajo stock cubre el caso.

## Testing

**Backend** — integración contra Postgres en Docker, como el resto del repo:
- abrir caja (reusa si ya hay una abierta);
- vender: descuenta stock y congela `precioUnit`;
- reintentar con el mismo `uid`: no duplica, no vuelve a descontar;
- deshacer: repone stock;
- cerrar: `totalUnidades` y `totalMonto` correctos;
- código inexistente: no crea venta;
- stock negativo permitido;
- **auth**: `x-buffet-key` inválida → 401; el JWT de admin no abre rutas de mostrador; la buffet-key no abre rutas de admin.

**Frontend** — automatizable: cálculo del total y manejo del código desconocido. **A mano, con el lector real:** la lógica de foco del scanner (escanear, tocar un botón, volver a escanear). Queda explícito como paso manual en el plan.

## Integración / deploy

- Backend: rama feature → merge a `main` **sin push** (regla vigente del usuario) + migración.
- Frontend: rama feature → `master` **sin push**.
- **Env nueva `BUFFET_API_KEY` en DOS lados:** el `.env` de la VM y las env vars de Vercel. Si falta en cualquiera, el mostrador da 401 sin explicación evidente. Va explícito en el plan.
- `/mostrador` debe quedar exceptuada del matcher de `src/middleware.ts`.

## Fuera de alcance (posibles mejoras futuras)

- Cantidad por teclado (3 cocas de un saque) — hoy son 3 escaneos.
- Medio de pago por venta.
- Declarar el efectivo contado al cerrar y mostrar la diferencia.
- Funcionamiento offline (LAN contra el `.36`): descartado porque el mostrador tiene internet estable.
