# Precio propio por duración (pádel) — Diseño

**Fecha:** 2026-08-06
**Estado:** Aprobado — falta escribir el plan de implementación

## Objetivo

Que una cancha pueda tener un **precio propio para cada duración**, en vez de derivarlo
proporcionalmente del precio por hora.

Caso concreto que lo motiva: el complejo quiere que 1½ hora de pádel salga **36.000** cuando hoy el
sistema cobra **40.500**. Con `precioHora = 27.000`, 40.500 es exactamente `27.000 × 1,5`: lo que se
pide es un **descuento de ~11%** que rompe la proporcionalidad.

## Por qué hoy no se puede

Cuando se diseñó la duración variable, los importes que dio el complejo eran proporcionales exactos
(30.000 / 45.000 / 60.000) y confirmó que no había descuento por duración. Por eso `precioDeRango`
calcula `precioHora × duración` y prorratea cuando el rango cruza el borde de la franja pico, y
**no existe ninguna tabla de precios por duración**. La decisión fue correcta entonces; el negocio
cambió.

## Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Forma del precio | **Un precio por duración Y por banda** (seis por cancha) | Máxima libertad y es lo que suele querer un predio. Las alternativas —precio fijo que ignora el pico, o un descuento porcentual— o pierden el recargo de hora pico justo en las duraciones más vendidas, o exigen despejar un porcentaje para llegar a un importe redondo. |
| Campos nuevos | **Opcionales** | Sin ellos se calcula como hoy. Restricción, no elección: hacerlos obligatorios obligaría a recargar precios en todas las canchas y rompería fútbol. |
| Prorrateo | **Se conserva, generalizado** | Sin él, arrancar 17:00 en vez de 18:00 vuelve a ser un truco para pagar menos la hora pico. |

## Modelo de datos

`Cancha` **ya tiene dos de los seis**: `precioHora` y `precioHoraPico` son el precio de 1 hora en
banda base y en pico. Se suman cuatro, todos opcionales:

```prisma
precio90       Decimal?  @db.Decimal(10, 2)
precio90Pico   Decimal?  @db.Decimal(10, 2)
precio120      Decimal?  @db.Decimal(10, 2)
precio120Pico  Decimal?  @db.Decimal(10, 2)
```

Una migración. Todos nullable: ninguna fila existente se toca.

## Comportamiento

**Con precio propio cargado para esa duración**, el precio del turno interpola entre las dos bandas
según los minutos que caen en cada una:

```
precio = precioDuracion × (minutosBase / duracion) + precioDuracionPico × (minutosPico / duracion)
```

Ejemplo con `precio90 = 36.000` y `precio90Pico = 45.000`, turno de 17:00 a 18:30 con pico desde
las 18:00 (60 min en base, 30 en pico):

```
36.000 × (60/90) + 45.000 × (30/90) = 24.000 + 15.000 = 39.000
```

Es la misma idea que hoy —cobrar cada tramo a su banda— pero interpolando entre los dos precios de
**esa duración**, en vez de entre los dos precios por hora.

**Sin precio propio para esa duración**, se calcula exactamente como hoy: `precioHora × duración`
prorrateado. Es el camino que siguen fútbol y cualquier cancha a la que no se le carguen los
campos nuevos.

**La decisión es por duración, no por cancha**: una cancha puede tener precio propio de 2 horas y
no de 1½; en ese caso 2 horas usa el suyo y 1½ cae al proporcional.

## Dónde impacta

- **`precio.service.ts`** (`precioDeRango`): es el único lugar donde se calcula el precio de un
  turno, así que el cambio queda contenido ahí. Sus cuatro consumidores no se tocan.
- **Formulario de canchas del panel**: los cuatro campos nuevos, junto a los dos que ya están.
  Solo tienen sentido en canchas que admiten esas duraciones (hoy, las que no son de fútbol —
  ver `reglasDeAgenda` en `precio.service.ts`).
- **Nada más.** La grilla de disponibilidad ya publica el precio que devuelve `precioDeRango`, así
  que la web pública y el panel muestran el precio nuevo sin cambios.

## Manejo de errores

- Precios negativos o cero → `BadRequest` desde el validador de canchas, con el mismo criterio que
  `precioHora`, que ya exige positivo.
- No se valida que el precio por duración sea menor al proporcional: un predio puede querer cobrar
  **más** por 2 horas (por ejemplo si implica mover luces o personal). Prohibirlo sería una regla de
  negocio que nadie pidió.

## Verificación

`precioDeRango` es aritmética de plata y ya tiene tests unitarios sin Docker
(`tests/unit/precio.service.test.ts`). Van casos nuevos:

- Con `precio90` cargado, un turno de 1½ hora en banda base cobra ese precio exacto, no el
  proporcional.
- Un turno de 1½ hora que cruza el borde interpola entre `precio90` y `precio90Pico`.
- **Regresión**: sin campos nuevos, todos los casos actuales dan lo mismo que hoy.
- Una cancha con `precio120` pero sin `precio90`: 2 horas usa el suyo, 1½ cae al proporcional.
- Fútbol (que solo admite 1 hora) no cambia.

## Fuera de alcance

- Precios por duración a nivel global o por deporte: son por cancha.
- Descuentos porcentuales como forma alternativa de cargarlos.
- Precios por día de la semana, más allá de la distinción semana/finde que ya existe en la franja
  pico.
- Histórico de precios: cambiar un precio no afecta a las reservas ya creadas, porque el monto se
  congela al reservar.
