# Buffet: pantallas de entrega y de conteo

## Problema

El backend de los dos mostradores está completo y testeado: el principal puede entregarle stock
al secundario, la venta del secundario descuenta de lo asignado, y al cerrar se concilia lo
entregado contra lo vendido. **Nada de eso se puede hacer desde una pantalla.** Sólo se llega
con `curl`.

Y hay tres huecos de backend que impiden construir esas pantallas aunque uno quisiera:

1. **`ProductoCobro` no expone el stock.** El POS recibe `{id, nombre, precio}`, así que en la
   pantalla de entrega el principal no puede ver de cuánto dispone para repartir.
2. **`GET /buffet/stock-asignado` devuelve el del que llama.** El principal obtiene el suyo, que
   siempre está vacío: no hay forma de que vea cuánto ya le dio al secundario.
3. **El principal no puede descubrir qué caja conciliar.** `GET /buffet/cajas` es admin con JWT y
   el POS no lo alcanza. Cuando el secundario cierra, el principal no se entera.

Además, la pantalla de venta muestra los mismos productos a los dos puestos. El secundario sólo
puede vender lo que le entregaron, así que tocar cualquier otro producto termina en un
`"No tenés stock asignado de X"` **en plena venta, con el cliente adelante**.

## Qué se construye

Las dos pantallas de operación del mostrador —entregar y contar al cierre—, el backend que les
falta, y el arreglo de la pantalla de venta del secundario.

## Cómo se opera hoy (lo que decidió el negocio)

Estas dos cosas se preguntaron y definen el diseño:

- **La entrega tiene dos usos**: una carga grande al abrir el turno (varios productos de una) y
  reposiciones sueltas durante el turno (uno o dos, a las apuradas). Una sola pantalla tiene que
  servir bien para ambos.
- **El conteo es inmediato y presencial**: el secundario cierra, junta lo que le sobró y se lo
  lleva al principal, que cuenta y carga los números ahí mismo. Por eso el aviso de "hay algo
  para conciliar" tiene que ser visible, no un ítem escondido en un menú.

## Backend

### `GET /buffet/stock-asignado` acepta `?mostradorId=`

Sigue devolviendo el del que llama cuando no se pasa nada. El **principal** puede además pedir el
de otro puesto; cualquier otro que pida uno ajeno recibe `403`.

Un solo endpoint con un solo significado —"stock asignado de X"— y su regla de autorización, en
vez de dos endpoints casi idénticos que se desincronizarían.

### `GET /buffet/conciliaciones/pendientes`

`authMostrador`, **solo el principal** (mismo guard que el `GET` de conciliación). Devuelve las
cajas que están `CERRADA`, todavía sin conteo, **y que NO son del mostrador principal**:

```ts
{ cajaId: string; mostradorNombre: string; cerradaEn: string; totalMonto: number }[]
```

Los tres filtros son necesarios. Excluir las del principal no es cosmético: `conciliar` las
rechaza explícitamente con `BusinessRule` —sobre una caja del principal el conteo *inventaría
stock*, porque esas unidades ya se descontaron del general al venderlas— así que listarlas sería
ofrecerle al operador una acción que siempre va a fallar.

Es lo que hoy no existe y sin lo cual la pantalla de conteo no tiene por dónde empezar. El filtro
de "sin conteo" es `conteos: { none: {} }`, la misma condición que ya usa `conciliar` para
rechazar una caja conciliada dos veces.

### `ProductoCobro` gana `stock`

El stock general. Es **aditivo**: la pantalla de venta que ya lo consume no se rompe.

## Pantallas

Todas cuelgan de `/mostrador`, que hoy es una única pantalla. Las nuevas son rutas hermanas.

### Entrega — `/mostrador/entregar`

Solo el principal; el secundario que entre por URL ve un mensaje, no un formulario roto.

Una fila por producto activo con **dos cifras**: cuánto hay en el general y cuánto ya tiene
asignado el secundario. Un input de cantidad por fila y un único botón "Entregar" al final.

Eso cubre los dos usos sin modos separados: para la carga inicial se completan varias filas; para
una reposición se completa una sola y se confirma. No se ofrece entregar más de lo que hay en el
general — el backend ya lo rechaza, y la pantalla lo evita antes.

La entrega es **todo o nada** (el servicio la hace en una transacción): si una línea falla, no se
aplica ninguna, y la pantalla lo dice así en vez de sugerir que algo se movió.

### Conteo — `/mostrador/conciliar/[cajaId]`

Solo el principal. Por producto muestra **entregado, vendido y esperado** —los tres los calcula
el backend— y un input para **lo contado**. Al confirmar, muestra la diferencia de cada línea.

Lo que vuelve al stock general es **lo contado**, no lo esperado. Es la decisión de fondo del
diseño original y la pantalla tiene que dejarlo claro, porque es contraintuitivo: si faltan dos
unidades, vuelven las que hay, y el faltante queda registrado.

En la pantalla del principal va un **aviso destacado** cuando `GET /buffet/conciliaciones/pendientes`
devuelve algo, con acceso directo. Si hay más de una caja esperando, se listan.

### Venta del secundario

Cada producto muestra su cantidad asignada, y los que están en cero quedan deshabilitados. El
principal no cambia: sigue vendiendo contra el stock general, sin números por producto.

## Casos borde

| Caso | Qué pasa |
|---|---|
| El secundario entra a `/mostrador/entregar` o `/conciliar` | Mensaje de "esto lo hace el mostrador principal", sin formulario |
| El principal entrega más de lo que hay | La pantalla lo impide; si igual llega, el backend responde y se muestra el mensaje |
| Una línea de la entrega falla | No se aplica ninguna, y se dice explícitamente |
| No hay nada para conciliar | Sin aviso; la pantalla de conteo por URL directa dice que esa caja no está pendiente |
| El secundario tiene una caja abierta | `conciliar` lo rechaza (guard ya implementado) y la pantalla muestra ese motivo |
| La caja ya fue conciliada | El backend responde 409 y la pantalla lo dice |
| El secundario no tiene nada asignado | Su botonera queda toda deshabilitada, con un mensaje de pedirle al principal |

## Testing

**Backend (integración, Testcontainers):**
- `GET /buffet/stock-asignado` sin query devuelve el del que llama.
- El principal pide `?mostradorId=mostrador-secundario` y recibe el del secundario.
- El secundario pidiendo el del principal recibe 403.
- `GET /buffet/conciliaciones/pendientes` lista una caja cerrada sin conteo, y **deja de listarla**
  una vez conciliada.
- No lista cajas abiertas.
- **No lista las cajas del propio principal**, aunque estén cerradas y sin conteo: conciliarlas
  falla siempre.
- El secundario recibe 403 al pedir pendientes.
- `/buffet/productos/activos` incluye `stock`.

**Frontend (vitest, funciones puras):**
- Cruzar productos activos con lo asignado: un producto sin fila de asignado queda en cero.
- El cálculo de la diferencia (`contado - esperado`), incluyendo negativo y positivo.

Las pantallas en sí se verifican a mano: `frontend/` tiene vitest pero el proyecto testea
helpers, no render.

## Fuera de alcance

- **Anular o corregir una entrega.** `entregar()` no es idempotente ni reversible: un doble tap
  mueve el stock dos veces y no hay endpoint para revertir. Ya estaba registrado como deuda del
  backend; resolverlo bien implica decidir si se anula la entrega o se hace una compensatoria.
- **El histórico de conciliaciones y de entregas**, y las vistas del panel: son la pieza C.
- **Que el secundario vea sus propios cierres pasados.**
- **Etiquetar `GET /buffet/cajas` por mostrador**: también es de la pieza C.
