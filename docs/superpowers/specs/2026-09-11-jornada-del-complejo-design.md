# La jornada del complejo: horarios que cruzan la medianoche

**Fecha:** 2026-09-11
**Estado:** diseño aprobado, pendiente de plan de implementación

## El problema

El complejo abre a las 07:00 y cierra a la 01:00 de la madrugada. El último turno arranca a las
00:00 y termina a la 01:00.

Hoy eso no se puede configurar. Al poner cierre `01:00` el panel responde *"La apertura (semana)
debe ser anterior al cierre"*, porque el sistema entiende esa hora como la una de la madrugada
**del mismo día**, antes de abrir.

El complejo tuvo que cargar `23:59` como cierre. La consecuencia, medida contra el código real:

| Cierre configurado | Minutos | Último turno fútbol | Último turno pádel |
|---|---|---|---|
| `23:59` (lo que hay hoy) | 1439 | 22:00 | 22:30 |
| `00:00` | 1440 | 23:00 | 23:00 |
| `01:00` (lo que se necesita) | 1500 | **00:00** | **00:00** |

Un turno se publica sólo si entra entero antes del cierre: con 23:59, el turno de 60 minutos que
arranca 23:00 terminaría un minuto después del cierre y se descarta. El complejo está perdiendo
**dos turnos por cancha por día**, en el horario de mayor demanda.

## La decisión de fondo

`fecha` deja de significar "día calendario" y pasa a significar **jornada del complejo**: de la
apertura al cierre, aunque cruce la medianoche.

**El turno de las 00:00 del viernes pertenece a la jornada del viernes**, aunque su instante real
caiga el sábado. Aparece al final de la agenda del viernes, cuenta como viernes en la caja, y no
aparece al buscar "las reservas del sábado".

Consecuencia que hay que tener presente en todo el trabajo: **para los turnos posteriores a
medianoche, la fecha del instante guardado y la jornada a la que pertenecen dejan de coincidir.**
Todo lo que hoy asume que coinciden hay que revisarlo. Ese es el grueso del trabajo, no permitir
el valor `01:00`.

## El concepto: minuto de jornada

Una sola regla, que reemplaza a los casos especiales dispersos:

```ts
/**
 * Minuto de una hora "HH:MM" dentro de la jornada que arranca en `apertura`.
 * Una hora anterior a la apertura pertenece al día siguiente y suma 1440.
 */
export function minutoDeJornada(hhmm: string, apertura: string): number {
  const m = hhmmAMin(hhmm);
  return m < hhmmAMin(apertura) ? m + 1440 : m;
}
```

Con apertura `07:00`:

| Hora | Minuto de jornada | Por qué |
|---|---|---|
| `07:00` | 420 | la apertura |
| `23:00` | 1380 | misma noche |
| `00:00` | 1440 | medianoche = fin del día / arranque del último turno |
| `01:00` | 1500 | madrugada del día siguiente |
| `22:30` | 1350 | misma noche |

Esta regla **subsume a `cierreMin`**, que hoy es un caso especial que sólo entiende `"00:00"` y
está repetido en backend y panel. En los caminos de jornada, `minutoDeJornada` lo reemplaza; el
resultado para las configuraciones actuales es idéntico, así que nada se rompe.

Sirve igual para las cuatro cosas que hoy se tratan por separado:

- **apertura y cierre** — `minutoDeJornada(cierre, apertura)` da 1500 para `01:00`
- **franja pico** — `picoHasta: "00:00"` da 1440, igual que hoy con `cierreMin`
- **rango de un fijo o bloqueo** — un fijo `23:00`→`01:00` da `[1380, 1500)`, que hoy daría negativo
- **hora de un slot** — el slot del minuto 1440 se etiqueta `00:00`

## Compatibilidad con lo que ya está configurado

| Apertura | Cierre | Hoy | Con jornada |
|---|---|---|---|
| 07:00 | 23:00 | 1380 | 1380 — igual |
| 07:00 | 00:00 | 1440 | 1440 — igual |
| 16:00 | 00:00 | 1440 | 1440 — igual |
| 07:00 | 01:00 | 60 (rechazado) | **1500** |

Sólo cambia el caso que hoy no se puede expresar. No hay migración de datos: es un cambio de
código.

## Instantes

Hoy el minuto se convierte a instante formateando `"HH:MM"` y combinándolo con la fecha. Con la
jornada eso se vuelve peligroso: el minuto 1440 formateado da `"00:00"`, y combinado con la misma
fecha produce **la medianoche del arranque del día — 24 horas antes de lo correcto.**

La conversión pasa a ser explícita:

```ts
/** Instante UTC del minuto `m` de la jornada de `fecha`. Cruza al día siguiente si m >= 1440. */
export function instanteDeJornada(fecha: string, m: number, tz: string): Date {
  return m < 1440
    ? combineDateTimeUtc(fecha, hhmmDeMin(m), tz)
    : combineDateTimeUtc(sumarDias(fecha, 1), hhmmDeMin(m - 1440), tz);
}
```

Se usa `combineDateTimeUtc` en las dos ramas, y no aritmética de milisegundos sobre el arranque
del día, para que siga siendo correcto ante un eventual cambio de huso.

## Ventana de ocupación

Es el punto crítico. Hoy la disponibilidad busca las reservas existentes con
`dayWindowUtc(fecha)`, una ventana de exactamente 24 horas. Un turno a las 00:00 cae **fuera**, y
la grilla lo mostraría libre estando ocupado.

```ts
/** Ventana UTC real de la jornada: de la apertura al cierre, aunque cruce la medianoche. */
export function jornadaWindowUtc(fecha: string, tz: string, apertura: string, cierre: string)
  : { start: Date; end: Date }
```

**Criterio de despliegue: o se migran todas las consultas de ocupación, o no se despliega.** Si
queda una sola con la ventana vieja, la grilla ofrece horarios ya tomados. La *exclusion
constraint* de Postgres impide la doble reserva real —el `INSERT` falla y devuelve 409— así que
no se vende dos veces la misma cancha, pero el cliente elige un horario y le rebota al confirmar.

## Qué se toca

**Consultas de ocupación** (las que obligan al criterio de arriba):

| Archivo | Qué asume hoy |
|---|---|
| `disponibilidad.service.ts:31` | `dayWindowUtc` para traer las reservas del día |
| `agenda.service.ts` | `inicioDia` + 86400000 para los fijos ya materializados |
| `reserva.service.ts:412` | `dayWindowUtc` al validar |
| `ocupacion.service.ts` | rangos de fijos y bloqueos en minutos del día calendario |

**Cierre de jornada:**

| Archivo | Qué cambia |
|---|---|
| `disponibilidad.service.ts:44` | tope del loop de slots |
| `reserva.service.ts:122, :382` | validación de cierre al crear y al reprogramar |
| `sheets/sheetsData.ts:39, :48` | columnas de horas del espejo (pueden pasar de 24 a 25) |
| `config.schema.ts` + `config.service.ts` | la validación apertura < cierre, hoy duplicada |
| `frontend/src/lib/validators.ts` | la misma regla, tercera copia |

**Precios:**

| Archivo | Qué cambia |
|---|---|
| `precio.service.ts` | `precioDeRango` recibe la apertura; pico y reserva en minutos de jornada |
| `disponibilidad`, `reserva`, `agenda`, `turnoFijo` | los cuatro llamadores le pasan la apertura del día |

**Presentación:**

| Archivo | Qué cambia |
|---|---|
| `frontend/src/lib/calendario.ts` | `horasDelDia` genera las horas de la jornada |
| `calendario-semana.tsx` | filas más allá de las 23:00 |
| `reservas/` | etiqueta del slot de las 00:00 |

**Listados por fecha** — decisión explícita: `reservaService.list({ fecha })` pasa a devolver la
jornada, no el día calendario, para que la agenda del viernes incluya su turno de las 00:00.
`caja`, `alquileres` y `analytics` **no** cambian: siguen siendo rangos de día calendario, porque
responden preguntas contables, no de agenda.

## Precios

`precioDeRango` también trabaja en minutos del día calendario, y eso lo rompe de dos formas a la
vez en cuanto la jornada cruza medianoche:

- La franja pico `20:00`→`01:00` se lee como `[1200, 60)`, o sea invertida, y la función corta
  temprano devolviendo **precio base**: el pico se anula por completo, todo el día.
- El turno de las 00:00 se lee como el **minuto 0**, así que no cae dentro de ninguna franja. El
  último turno de la jornada, que es el más caro, saldría a precio base.

Por eso `precioDeRango` pasa a recibir la apertura y a expresar en minutos de jornada tanto la
franja pico como el rango de la reserva. Es un cambio de firma: hoy recibe un `PicoCfg` con los
cuatro campos de pico, y pasa a necesitar también `horaApertura` / `horaAperturaFinde`.

Esto importa más de lo que parece: el cliente ya reportó que *"no está respetando la hora pico"*.
Con el cierre en `23:59` ese síntoma tiene otras causas posibles, pero en cuanto la jornada cruce
medianoche este camino lo produciría con certeza. Arreglarlo es parte de este trabajo, no de otro.

Los cuatro llamadores de `precioDeRango` (`disponibilidad`, `reserva`, `agenda`, `turnoFijo`)
tienen que pasarle la apertura correspondiente al día que están calculando — de semana o de finde,
según la fecha.

## Fijos y bloqueos

`diaSemana` se refiere a la **jornada**. Un fijo "viernes 00:00" se juega la madrugada del sábado
y pertenece al viernes, igual que en la agenda y en la caja.

Sus rangos se expresan con `minutoDeJornada`, lo que además arregla el caso hoy imposible del fijo
que cruza medianoche (`23:00`→`01:00` pasa de duración negativa a `[1380, 1500)`).

## Etiquetas

El último turno se muestra **`00:00`**, como lo dice un reloj y como lo dice el cliente. Aparece
después del de 23:00, así que el orden deja claro que es el cierre de la jornada y no el arranque
del día. No se usa `24:00`.

## Fuera de alcance

- Turnos que duren más de una jornada.
- Horarios por cancha: siguen siendo globales.
- Migración de datos: las reservas existentes no se tocan.
- Cambiar qué significa la fecha en caja, alquileres o analytics.

## Tests

La regla es que ningún cambio de ocupación se da por bueno sin un test que falle antes.

- **Unitarios** (sin Docker): `minutoDeJornada` e `instanteDeJornada` en toda la tabla de casos,
  incluida la compatibilidad con las configuraciones actuales.
- **Integración**: la grilla con cierre `01:00` publica el turno de las 00:00; ese turno se puede
  reservar; una vez reservado **deja de ofrecerse** (el caso que prueba que la ventana de
  ocupación se migró de verdad); un fijo y un bloqueo a las 00:00 ocupan su rango; un fijo
  `23:00`→`01:00` tiene duración 120 y no negativa.
- **Precios**: con pico `20:00`→`01:00`, el turno de las 00:00 se cobra a precio **pico** y no
  base; un turno de 90 minutos que arranca 23:30 se prorratea correctamente cruzando la
  medianoche; y con las franjas de hoy (que terminan a las 23:00 o 00:00) los precios salen
  idénticos a los actuales.
- **Regresión**: con cierre `23:00` y con `00:00`, la grilla publica exactamente los mismos slots
  que hoy. Es lo que prueba que no se rompió a nadie.

## Antecedentes

Dos arreglos previos dejaron el terreno preparado, ya en la rama `fix/horarios-medianoche`:

- `d74eb4d` — las validaciones comparaban las horas como texto y rechazaban toda hora de fin a
  medianoche. Estaba repetido en siete lugares.
- `309675a` — la capa de ocupación leía `"00:00"` como minuto 0: un bloqueo de 23:00 a medianoche
  ocupaba un rango vacío, y una reserva que terminaba a medianoche era invisible al crear un fijo
  o bloqueo encima.

Ese segundo arreglo es la evidencia de que el riesgo descrito en "Ventana de ocupación" es real y
no teórico: el mismo tipo de error ya estaba en el código y nadie lo había visto.
