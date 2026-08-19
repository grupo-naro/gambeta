# Módulo de alquileres

## Problema

El complejo presta cosas: raquetas y pelotas de pádel, pelotas de fútbol, indumentaria para
torneos. Hoy eso no existe en el sistema. Se anota en un papel, o no se anota. Las consecuencias
son dos y las dos cuestan plata:

1. **No se sabe qué está afuera.** Cuando alguien pide una raqueta, la única forma de saber si
   queda alguna es ir a mirar. Y cuando algo no vuelve, nadie se entera hasta que hace falta.
2. **El alquiler no entra a la caja.** Se cobra a mano y queda fuera del arqueo del mostrador,
   así que el cierre del día no cuadra con lo que realmente entró.

## Qué se construye

Un módulo de alquileres con inventario propio, ciclo de vida entregado → devuelto, cobro al
entregar que suma a la caja del mostrador, y un catálogo administrable desde el panel.

## Lo que decidió el negocio

Estas respuestas definen el diseño entero:

- **El alquiler es un préstamo**, no una venta: el artículo tiene que volver y el sistema
  controla ese retorno.
- **El inventario se lleva por cantidad**, no por unidad identificable. "Tengo 12 raquetas, hay
  3 afuera, quedan 9". No importa cuál raqueta se llevó cada uno.
- **Se opera desde el mostrador** (`/mostrador`, con PIN), que es donde está la gente y las
  raquetas. El catálogo, en cambio, se administra desde el panel: igual que los productos de
  buffet.
- **Se cobra al entregar**, con precio fijo por artículo, y entra a la caja abierta del
  mostrador como plata más.
- **A quien retira se lo identifica con un nombre libre y una garantía retenida** (DNI, llaves,
  un depósito). Sin vínculo con `Cliente`: la fricción de buscar un cliente por WhatsApp para
  prestar una pelota no la paga nadie.
- **Lo que no vuelve se cierra como PERDIDO o ROTO y sale del inventario.** Sin cargo de
  reposición: esa plata, si se cobra, se cobra fuera del sistema.

## Dos recortes deliberados

**Los alquileres son solo del mostrador PRINCIPAL.** El secundario vende contra el stock que le
asignaron y su cierre se concilia contra ese conteo; meter alquileres ahí obligaría a repartir
también las raquetas y a conciliarlas. El principal tiene el stock general, que es exactamente
lo que el alquiler necesita. Las rutas de mostrador rechazan al secundario con `Forbidden`.

**La devolución es del alquiler entero.** Si alguien se lleva 3 raquetas y vuelve con 2 más una
rota, el mostrador tuvo que haber registrado dos alquileres. La alternativa —contadores
`devueltas` / `perdidas` por fila, con estados intermedios— cuesta bastante más de lo que
resuelve para un caso que además tiene una salida manual obvia. Si la práctica muestra que pasa
seguido, se cambia a una fila por unidad y la devolución parcial sale gratis.

## Modelo de datos

```prisma
enum EstadoAlquiler {
  ENTREGADO   // está afuera
  DEVUELTO
  PERDIDO
  ROTO
}

model ArticuloAlquiler {
  id         String     @id @default(cuid())
  nombre     String
  precio     Decimal    @db.Decimal(10, 2)
  /// Unidades que tiene el complejo. Baja solo cuando algo se pierde o se rompe.
  stock      Int        @default(0)
  /// Unidades afuera AHORA. `stock - prestado` es lo que se puede prestar.
  prestado   Int        @default(0)
  activo     Boolean    @default(true)
  orden      Int        @default(0)
  alquileres Alquiler[]
}

model Alquiler {
  id          String           @id @default(cuid())
  /// Idempotencia del cobro, igual que `TicketBuffet.uid`: el mostrador es una pantalla táctil
  /// y un doble toque no puede cobrar ni prestar dos veces.
  uid         String           @unique
  cajaId      String
  caja        CajaBuffet       @relation(fields: [cajaId], references: [id])
  articuloId  String
  articulo    ArticuloAlquiler @relation(fields: [articuloId], references: [id])
  cantidad    Int
  quienRetira String
  garantia    String?
  /// Congelado al entregar: cambiar el precio del catálogo no reescribe la historia.
  precioUnit  Decimal          @db.Decimal(10, 2)
  total       Decimal          @db.Decimal(10, 2)
  medioPago   MedioPago
  estado      EstadoAlquiler   @default(ENTREGADO)
  entregadoEn DateTime         @default(now())
  cerradoEn   DateTime?

  @@index([estado])
  @@index([cajaId])
}
```

`CajaBuffet` gana `totalAlquileres Decimal?` (ver más abajo).

### Las tres transiciones

| Acción | `prestado` | `stock` | Estado |
|---|---|---|---|
| Entregar | `+= cantidad` | — | ENTREGADO |
| Devolver | `-= cantidad` | — | DEVUELTO |
| Cerrar perdido / roto | `-= cantidad` | `-= cantidad` | PERDIDO / ROTO |

Son las únicas que tocan contadores, y cada una ocurre dentro de una transacción junto con la
escritura del `Alquiler`. Cerrar un alquiler que ya está cerrado no vuelve a descontar: la
transición solo se aplica desde `ENTREGADO`.

### La base es la que garantiza

Dos `CHECK` en la migración, con el precedente de `StockMostrador_cantidad_no_negativa`:

```sql
ALTER TABLE "ArticuloAlquiler"
  ADD CONSTRAINT "ArticuloAlquiler_prestado_no_negativo" CHECK ("prestado" >= 0);
ALTER TABLE "ArticuloAlquiler"
  ADD CONSTRAINT "ArticuloAlquiler_prestado_no_supera_stock" CHECK ("prestado" <= "stock");
```

El servicio pre-chequea la disponibilidad, pero dos entregas concurrentes del mismo artículo
pueden ver ambas "queda 1". La que pierde la carrera choca contra el `CHECK`, y ese `23514` se
captura **por nombre de constraint** y se traduce a un `BusinessRule` con el mismo mensaje que
daría el pre-chequeo — exactamente el patrón de `esViolacionStockAsignadoNegativo` en
`buffetCaja.service.ts`. Nunca un 500.

## Backend

### Servicios

**`alquilerArticulo.service.ts`** — el catálogo: alta, edición, activar/desactivar, ajuste de
stock, y el listado con `disponible = stock - prestado` calculado. Bajar el stock por debajo de
lo que está prestado se rechaza con `BusinessRule`.

**`alquiler.service.ts`** — la operación:

- `entregar()`: valida caja abierta y mostrador principal, resuelve idempotencia por `uid`,
  calcula total y vuelto con la misma regla que `cobrar()` (efectivo exige
  `montoPagado >= total`; transferencia no da vuelto), y en una transacción crea el `Alquiler` e
  incrementa `prestado`.
- `cerrar()`: aplica la transición según el estado pedido.
- `afuera()`: lo que está ENTREGADO, para la pantalla del mostrador.
- `historial()`: con filtros de rango de fechas y estado, para el panel.

### Rutas — `alquiler.routes.ts`, montado en `/alquileres`

| Método | Ruta | Auth |
|---|---|---|
| GET | `/alquileres/botonera` | `authMostrador` |
| POST | `/alquileres/entregas` | `authMostrador` |
| GET | `/alquileres/afuera` | `authMostrador` |
| POST | `/alquileres/:id/cerrar` | `authMostrador` |
| GET | `/alquileres/articulos` | `authJwt` |
| POST | `/alquileres/articulos` | `authJwt` + `requireRole('ADMIN')` |
| PATCH | `/alquileres/articulos/:id` | `authJwt` + `requireRole('ADMIN')` |
| GET | `/alquileres` | `authJwt` |

Las rutas literales (`/botonera`, `/afuera`, `/entregas`, `/articulos`) van **antes** que
`/:id/cerrar`, con el mismo comentario de orden que lleva `buffet.routes.ts`. Las mutaciones de
admin registran `auditService.log(...)`.

Validadores en `validators/alquiler.schema.ts`.

### Integración con la caja: exactamente dos puntos

En `buffetCaja.service.ts`:

- **`estadoDe()`** suma los alquileres de esa caja a `totalMonto`, `totalEfectivo` y
  `totalTransferencia`, y agrega un `totalAlquileres` propio a `CajaEstado`.
- **`detalleCierre()`** hace lo mismo sobre `CierreDTO` y agrega el desglose por artículo.
- **`cerrar()`** persiste `totalAlquileres` en la fila de `CajaBuffet`.

**`totalUnidades` no se toca.** Cuenta productos de buffet vendidos y es la cifra que mira la
conciliación del secundario; sumarle raquetas rompería un número que hoy significa otra cosa.
Por la misma razón el `totalMonto` **almacenado** en `CajaBuffet` sigue siendo el del buffet: un
cierre viejo tiene que seguir queriendo decir lo mismo que cuando se guardó.

`buffetConciliacion.service.ts` calcula su total sumando tickets por su cuenta, no desde
`CierreDTO`. O sea: **la conciliación no se entera de los alquileres**, que es justo lo que se
busca.

## Frontend

### Mostrador — `/mostrador/alquileres`

Pantalla propia, no un tab dentro de `pantalla-venta.tsx`: ese componente ya carga carrito,
botonera, cobro, conciliación y stock asignado, y sumarle alquileres lo empuja a hacer demasiado.

Server component que trae botonera y alquileres afuera con `buffetFetch`, delegando en
`<PantallaAlquileres>` cliente, con dos mitades:

- **Entregar**: se toca el artículo (muestra "quedan N"), nombre de quien retira, garantía,
  medio de pago, confirmar. El `uid` se genera en el cliente, como en el cobro del buffet.
- **Afuera**: la lista de lo prestado, cada ítem con su cierre → Devuelto / Perdido / Roto.

El acceso aparece solo si el mostrador es PRINCIPAL y la página redirige al secundario. El
backend ya se protege solo; esto evita ofrecerle un botón que siempre va a dar 403.

Acciones en `src/lib/alquiler-actions.ts` (`'use server'`, todas `async`, devolviendo
`Resultado<T>`): `entregarAlquiler`, `cerrarAlquiler`.

`pantalla-venta.tsx` solo suma una línea para mostrar el `totalAlquileres` que ahora viene en el
estado de caja. El resto del flujo de buffet queda igual.

### Panel — `/alquileres`

Dos vistas con un `SubNav` como el de buffet:

- **Artículos**: tabla del catálogo con `disponible / stock / prestado`, diálogo de alta y
  edición, ajuste de stock. Calcado de `productos-table.tsx` y `producto-dialog.tsx`.
- **Movimientos**: historial con filtro de fechas y estado, y arriba un aviso con lo que sigue
  afuera y las pérdidas del período.

Acciones en `src/lib/alquiler-admin-actions.ts`, espejando `buffet-admin-actions.ts`.
`requireAdmin()` en las páginas de catálogo, y entrada nueva en el menú lateral.

## Migración y tests

Migración `alquileres`: las dos tablas, el enum, `CajaBuffet.totalAlquileres` y los dos `CHECK`.

En `tests/helpers/db.ts`, `resetTables()` suma `alquiler` y `articuloAlquiler` **antes** de
`cajaBuffet` — el orden importa por las FK.

**Integración** (estilo `buffet-*.test.ts`):

| Archivo | Qué cubre |
|---|---|
| `alquiler-entrega.test.ts` | entregar descuenta disponible y cobra; sin caja abierta → 409; `uid` repetido no duplica; no se puede entregar más de lo disponible; el secundario recibe 403; la carrera concurrente da `BusinessRule`, no 500 |
| `alquiler-devolucion.test.ts` | DEVUELTO restituye disponible sin tocar stock; PERDIDO y ROTO bajan stock; cerrar dos veces no descuenta dos veces |
| `alquiler-caja.test.ts` | el alquiler suma a `totalMonto` / efectivo / transferencia y a `totalAlquileres`, **no** a `totalUnidades`; el cierre lo persiste; la conciliación del secundario sigue dando lo mismo |
| `alquiler-articulos.test.ts` | CRUD del catálogo, auth (recepcionista no crea), auditoría, no bajar stock por debajo de lo prestado |

**Unit** `alquiler.reglas.test.ts`: cálculo de vuelto y transiciones de estado, sin Docker.

## Fuera de alcance

- Alquileres desde el mostrador secundario.
- Devolución parcial de un alquiler de varias unidades.
- Cargo de reposición por lo perdido o roto.
- Vínculo con `Cliente`, historial de morosos, alquiler por tiempo, reservas de artículos a
  futuro.
