# Buffet con dos mostradores — Diseño

**Fecha:** 2026-08-07
**Estado:** Aprobado — listo para plan de implementación
**Reemplaza:** `2026-08-06-buffet-dos-mostradores-BORRADOR.md`

## Objetivo

El complejo atiende el buffet desde dos puestos: uno **principal** y uno **secundario**. El
principal le entrega mercadería al secundario cada día, y al cerrar quiere revisar **cuánto le
dio contra cuánto vendió**, para detectar faltantes.

## Por qué hoy no se puede

**El mostrador es anónimo.** `authBuffet` valida una única `x-buffet-key` compartida y el PIN es
uno solo, guardado como `Configuracion.buffetPinHash`. Nada en el sistema registra *quién*
vendió: `ProductoBuffet` tiene un solo campo `stock`, y aunque `CajaBuffet` ya modela sesiones de
mostrador, no distingue puestos.

Sin saber quién vendió cada ticket, la conciliación es imposible. Ese es el cambio de fondo; todo
lo demás cuelga de él.

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Identidad del mostrador | Un **PIN distinto por mostrador** |
| ¿La entrega mueve stock? | **Sí**: baja del general y sube al asignado del secundario |
| ¿Qué pasa con el sobrante? | **Vuelve al stock general** al cerrar |
| ¿Cómo se determina el sobrante? | **Se cuenta a mano** y el sistema compara |
| ¿Se puede vender sin stock asignado? | **No**, se bloquea |

## Identidad de los mostradores

Va una tabla **`Mostrador`**: nombre, si es principal o secundario, y su propio hash de PIN. El
PIN único de hoy pasa a ser el del principal, así el operador no tiene que reaprender nada, y
`Configuracion.buffetPinHash` se retira.

**`CajaBuffet` pasa a apuntar a un mostrador.** Ese es el eslabón que faltaba: cada ticket
pertenece a una caja y cada caja a un mostrador, así que "cuánto vendió el secundario" es una
consulta directa. Las cajas que ya existen se asignan al principal.

La experiencia no cambia: se entra a `/mostrador`, se pone el PIN, y el sistema ya sabe quién es.
La `BUFFET_API_KEY` sigue siendo una sola —identifica al dispositivo—; lo que identifica a la
persona es el PIN.

## El stock

**El stock general que ya existe sigue siendo el del principal.** No se migra a ningún lado: todo
lo que hoy lo lee —el panel, la alerta de stock bajo, la planilla de Google— sigue funcionando sin
cambios. El principal vende contra ese stock, como siempre.

Lo nuevo es una tabla chica con **cuánto tiene asignado el secundario de cada producto**.

- Al entregar 12 unidades: el general baja 12, el asignado del secundario sube 12.
- Al vender una en el secundario: su asignado baja 1 y **el general no se toca** — esa unidad
  salió del general al entregarla.

Esa asimetría es deliberada: modelar también al principal en la tabla nueva obligaría a migrar
todo el stock existente y a tocar cada consumidor de `ProductoBuffet.stock`, sin ganar nada.

**El asignado del secundario es, en todo momento, el sobrante esperado.** De ahí sale la
conciliación sin cálculos intermedios.

### La entrega

Cada entrega queda registrada con fecha, quién la hizo y qué productos: es el "cuánto le di".

**Tiene que ser rápida de hacer.** Como vender sin stock asignado está bloqueado, una entrega
engorrosa termina en que cobran por afuera del sistema — peor que no tener control. Va como una
pantalla que el principal abre **desde su propio mostrador**, no desde el panel de admin, con la
misma botonera de productos que ya usa para vender: toca el producto, pone la cantidad, listo.

### Lo que el panel muestra como "stock"

Con el stock en dos bolsas, ese número pasa a ser *lo que hay en el principal*, no lo que hay en
el complejo. Si el secundario tiene 12 unidades asignadas, el panel diría que hay menos de las que
realmente existen, y la alerta de stock bajo dispararía por unidades que sí están.

Se resuelve mostrando las dos cifras juntas en la vista de productos —en el principal / asignadas
al secundario— y contando ambas para la alerta.

## El cierre y la conciliación

Son **dos pasos separados**, y en ese orden:

1. El secundario **cierra su caja** con la plata, exactamente como hoy. Eso corta las ventas.
2. El principal **carga el conteo físico** de esa caja ya cerrada, con su PIN.

Las cuatro cifras que muestra la pantalla —**entregado, vendido, esperado y contado**— son todas
del período de esa caja: entregado es lo que se le pasó al secundario desde que la abrió.

Esa diferencia es el faltante: lo que se tomaron, se rompió o no se cobró. **Se guarda, no solo se
muestra**, para poder mirar la semana pasada y ver si es siempre el mismo producto.

**Lo que vuelve al stock general es lo contado, no lo esperado.** Es la decisión más importante del
diseño: devolviendo lo esperado, cada unidad regalada volvería al general como una unidad que no
existe, y el stock del complejo mentiría un poco más cada día sin que nadie se entere. Devolviendo
lo contado, el faltante desaparece del sistema, que es lo que pasó en la realidad.

**El conteo lo carga el principal, con su PIN.** Si quien pudo haber regalado la mercadería es
también quien declara cuánto quedó, el control no controla nada.

**Hasta que no se carga el conteo, el asignado no vuelve al general.** Es rígido a propósito: si
alguien se saltea el paso, queda mercadería "en el aire" que se ve enseguida, en vez de un faltante
que se disuelve en silencio.

La conciliación la ven el principal (al cerrar) y el administrador (en el panel, con histórico). El
secundario no.

## Manejo de errores

- **Vender sin stock asignado** → se rechaza con un mensaje que diga qué producto falta, para que
  el operador sepa qué pedirle al principal.
- **Entregar más de lo que hay en el general** → se rechaza. No se permite stock general negativo.
- **Conteo negativo o no numérico** → se rechaza desde el validador.
- **Contar más de lo esperado** → se permite. Es una diferencia legítima (una entrega no cargada,
  un error de conteo previo) y esconderla sería peor; se muestra como diferencia positiva.
- Todos con las factories de `src/utils/errors.ts`, como el resto del backend.

## Verificación

Toca stock y plata, así que va cubierto contra la base real:

- La entrega mueve el stock en las dos direcciones y no inventa unidades.
- Una venta del secundario descuenta de su asignado y **no** del general.
- Vender sin asignado se rechaza.
- El cierre calcula bien la diferencia, con un caso donde falten unidades.
- **Lo que vuelve al general es lo contado y no lo esperado** — el corazón del diseño.
- Sin conteo cargado, el asignado no vuelve al general.
- Dos ventas simultáneas del mismo producto no dejan el asignado en negativo.
- Regresión: el mostrador principal sigue funcionando exactamente como hoy.

## Fuera de alcance

- **Más de dos mostradores.** La tabla `Mostrador` no lo impide, pero no se diseña ni se prueba
  para eso.
- **Que el secundario tenga su propio catálogo o precios distintos.** Los productos y precios son
  del complejo.
- **Transferencias entre mostradores en ambos sentidos.** Solo principal → secundario; lo que
  vuelve, vuelve por el cierre.
- **Reponer stock general desde el mostrador.** La carga de mercadería nueva sigue siendo del panel.
