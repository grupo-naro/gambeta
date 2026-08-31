# Buffet: las vistas del panel

## Problema

El buffet ya opera con dos mostradores: el principal le entrega mercadería al secundario, el
secundario vende contra su stock asignado, y al cerrar se concilia lo entregado contra lo vendido.
Todo eso funciona y está desplegado.

Pero el panel del administrador **se quedó en un solo mostrador**, y eso lo volvió engañoso:

1. **La alerta de stock bajo miente.** `/buffet` compara `p.stock <= p.stockMinimo`, y `p.stock` es
   el stock **general** — el del principal. Las unidades entregadas al secundario **salieron** de
   ahí. Con 20 Cocas de las que 15 están en el otro puesto, el general queda en 5, y el panel avisa
   "stock bajo: Coca (5)" aunque en el complejo haya 20. La alerta existe para disparar una compra;
   hoy dispara por unidades que ya se compraron.
2. **Los cierres son anónimos.** `/buffet/cierres` lista las cajas cerradas de los dos puestos
   entremezcladas, sin decir cuál es cuál. Los datos no están mal: están sin etiquetar.
3. **La conciliación no se puede mirar.** Cada cierre guarda cuatro cifras por producto —entregado,
   vendido, esperado, contado— más la diferencia. Se guardan justamente "para poder mirar el
   histórico y ver si el faltante es siempre del mismo producto", y no hay ninguna pantalla que lo
   muestre.
4. **Las entregas son invisibles.** `entregar()` no es idempotente ni reversible: un doble tap mueve
   el stock dos veces, y no hay forma de enterarse.

## Qué se construye

Las vistas del panel que faltan, y el backend que necesitan.

## Decisiones tomadas

Cada una se decidió explícitamente durante el brainstorming; se registran con su motivo para que la
implementación no las revierta.

**La alerta de stock mide el total del complejo** (general + asignado al secundario), no el general.
Es la decisión que la alerta dispara: cuándo hay que **comprar**. La tabla igual muestra las dos
cifras por separado, porque saber *dónde* está la mercadería también importa.

**El histórico de conciliaciones se agrupa por producto**, no por cierre. La pregunta que motivó
guardar las cuatro cifras es "¿falta siempre lo mismo?", y una lista cronológica obliga a buscar el
patrón a ojo. El detalle por cierre queda disponible al abrir un producto.

**La lista de entregas se hace**, aunque el histórico ya muestre el agregado de lo entregado. Lo que
agrega y el otro no: **ver una entrega duplicada**. No arregla el doble tap — lo vuelve visible,
que hoy es un agujero ciego.

**Ventana por defecto: 90 días**, con filtro de fechas. Sin ventana la consulta crece sin techo, y
"faltó siempre lo mismo" pierde valor cuanto más viejo es el dato.

## Backend

### `CierreDTO` gana el mostrador

`{ mostradorId: string; mostradorNombre: string }`. `GET /buffet/cajas` acepta `?mostradorId=` para
filtrar: **el parámetro ya existe en `listCierres(mostradorId?)`** desde la pieza B y quedó sin
cablear a la ruta.

### `GET /buffet/conciliaciones/resumen`

Admin (`authJwt` + `requireRole('ADMIN')`). Acepta `?desde=&hasta=` (ISO `YYYY-MM-DD`); sin
parámetros, los últimos 90 días.

```ts
{
  productoId: string; nombre: string;
  cierres: number;      // en cuántos cierres apareció
  entregado: number; vendido: number; contado: number;
  diferencia: number;   // la suma de las diferencias, negativa = faltó
}[]
```

Ordenado por `diferencia` **ascendente**: como el faltante es negativo, lo que más falta queda
primero. Sale de agregar `ConteoCierreLinea` agrupado por producto.

**`esperado` no va en el agregado a propósito**: es exactamente `entregado - vendido`, así que
sumarlo sería repetir un dato derivable. En el detalle por cierre sí aparecen las cuatro cifras,
porque ahí el valor está en poder leer la fila tal como quedó registrada.

**La ventana filtra por `CajaBuffet.cerradaEn`**, no por la fecha del conteo: lo que se está
mirando es el turno al que pertenece el faltante.

### `GET /buffet/cajas/:id/conteo`

Admin. Las filas de `ConteoCierreLinea` de esa caja, tal como quedaron guardadas.

**No confundir con `GET /buffet/cajas/:id/conciliacion`**, que ya existe: aquel es del *mostrador*,
calcula el resumen en vivo para poder contar, y desde la pieza B **rechaza las cajas ya
conciliadas**. Este lee lo registrado y solo tiene sentido sobre una caja ya conciliada.

### `GET /buffet/entregas`

Admin. Acepta `?desde=&hasta=`; sin parámetros, los últimos 90 días. Cronológico descendente:

```ts
{
  id: string; creadaEn: string;
  conciliada: boolean;   // si ya se rindió en un cierre
  lineas: { productoId: string; nombre: string; cantidad: number }[];
}[]
```

`conciliada` es `conciliadaEnCajaId !== null`. **La ventana filtra por `EntregaMostrador.creadaEn`**:
acá lo que interesa es cuándo se entregó, no en qué cierre terminó rindiéndose.

### `GET /buffet/productos` gana `asignado`

Las unidades que ese producto tiene en el secundario (0 si no tiene fila en `StockMostrador`). Es
aditivo: los consumidores actuales no se rompen.

## Panel

### `/buffet` — la alerta y la tabla

La alerta pasa a `stock + asignado <= stockMinimo`, y su texto muestra el total. La tabla de
productos suma una columna con lo que está en el secundario, para que el número del general no se
lea como "todo lo que hay".

### `/buffet/cierres` — etiquetados

Cada cierre dice de qué mostrador es. Se agrega un filtro por mostrador, que es lo que vuelve útil
el `?mostradorId=` recién cableado.

### `/buffet/conciliaciones` — nueva

La tabla del resumen, lo peor arriba: producto, en cuántos cierres apareció, y la diferencia
acumulada. Al abrir un producto se ven sus cierres, con las cuatro cifras de cada uno.

Las diferencias negativas se destacan; cero se muestra como "sin diferencia" y no como `0`, porque
la ausencia de faltante es la lectura importante.

### `/buffet/entregas` — nueva

La lista cronológica, agrupando las líneas de cada entrega. Las que todavía no se rindieron se
distinguen de las ya conciliadas.

## Casos borde

| Caso | Qué pasa |
|---|---|
| Sin conciliaciones en la ventana | Mensaje de que no hay datos en ese período, no una tabla vacía |
| Sin entregas en la ventana | Ídem |
| Un producto con diferencia 0 en todos sus cierres | Aparece al final, "sin diferencia" |
| Un producto borrado o inactivo con historial | Sigue apareciendo: el histórico es de lo que pasó, no del catálogo actual |
| Una caja sin conciliar en `/buffet/cajas/:id/conteo` | Devuelve lista vacía; la vista lo dice |
| `desde` posterior a `hasta` | 400 |
| Producto sin fila en `StockMostrador` | `asignado: 0` |

## Testing

**Backend (integración, Testcontainers):**
- El resumen agrega la diferencia de **varios cierres** del mismo producto.
- Ordena por diferencia ascendente.
- La ventana de fechas filtra: un cierre fuera del rango no entra.
- `desde > hasta` da 400.
- `GET /buffet/cajas/:id/conteo` devuelve lo guardado, y vacío para una caja sin conciliar.
- `GET /buffet/entregas` marca `conciliada` según corresponda.
- `GET /buffet/productos` devuelve `asignado` con lo entregado, y `0` sin fila.
- Los cierres traen `mostradorNombre`, y `?mostradorId=` filtra.

**Panel:** son vistas de lectura sin lógica propia. Si algún cálculo se vuelve no trivial (por
ejemplo el total de la alerta), va a un helper puro con su test, como ya hace el proyecto.

## Fuera de alcance

- **Arreglar el doble tap de la entrega.** Esta pieza lo vuelve *visible*, no imposible. La solución
  real es una clave de idempotencia en `POST /buffet/entregas`, como ya usa `cobrar` con el `uid`
  del ticket.
- **Anular o revertir una entrega.**
- **Que cambiar el PIN revoque los tokens ya emitidos** (hoy la palanca es desactivar el mostrador).
- **Auditar `PATCH /buffet/mostradores/:id`.**
- **Que el secundario vea sus propios cierres**: el panel es del administrador.
