# Reservas de duración variable y precio prorrateado — Diseño

**Fecha:** 2026-08-04
**Estado:** Aprobado

## Objetivo

Permitir reservar **1 hora, 1½ horas o 2 horas**, con el precio calculado por duración y
prorrateado cuando la reserva cruza el borde de la franja pico.

### El pedido original y qué resultó ser

El complejo pidió "promociones por hora" en pádel:

| Banda | 1 h | 1½ h | 2 h |
|---|---|---|---|
| L–V 8 a 18 | 30.000 | 45.000 | 60.000 |
| 18 a 24 | 36.000 | 54.000 | 72.000 |

**No son promociones: son proporcionales exactos.** `45.000 = 30.000 × 1,5`,
`60.000 = 30.000 × 2`, `54.000 = 36.000 × 1,5`, `72.000 = 36.000 × 2`. No hay bonificación por
reservar más tiempo — es `precioHora × duración`, con 30.000/h en banda baja y 36.000/h en pico.

Confirmado con el usuario: **no se diseña ninguna tabla de precios por duración.** Las dos bandas
ya las cubre el mecanismo `precioHora` / `precioHoraPico` que existe.

Lo que falta no es precio, es **duración**: el sistema solo sabe reservar bloques de 1 hora.

## Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Precio por duración | `precioHora × horas`, sin descuentos | Los números del complejo son proporcionales exactos. |
| Cruce de franja pico | **Prorrateado por tramo** | 17:00–19:00 = 1 h base + 1 h pico = 66.000. Cobrar por hora de inicio regalaría plata e incentivaría arrancar 17:00 para pagar menos la hora pico. |
| Granularidad de inicio | **Cada 30 minutos** | Sin esto, cada reserva de 1½ h deja un hueco de 30 min invendible. |
| Duraciones permitidas | **{60, 90, 120} minutos, en todas las canchas** | Conjunto fijo, simple de validar. Nadie pidió una cuarta. |
| Horario y franja pico | **Siguen siendo globales** del complejo | Confirmado: pádel y fútbol comparten horario y pico. |
| Alcance | Backend + panel + web pública | Es lo que resuelve el pedido de punta a punta. |

## Contexto (estado actual)

- **Todas las reservas duran exactamente 1 hora, hardcodeado.**
  - `reserva.service.ts:69` — `const fechaFin = new Date(fechaInicio.getTime() + 60 * 60 * 1000)`
  - `reserva.service.ts:73` y `:297` — los chequeos de conflicto usan `iniMin + 60`
  - `reserva.service.ts:288` — igual en `reprogramar`
  - `disponibilidad.service.ts:10` — `const SLOT_MIN = 60`
- **`precioEfectivo()`** (`precio.service.ts`) devuelve un precio **plano**: mira solo `horaInicio`
  y no multiplica por nada. La consumen `reserva.service.ts:83`, `turnoFijo.service.ts:122`,
  `agenda.service.ts:40` y `disponibilidad.service.ts:101`.
- **El esquema ya está listo para duración variable.** `Reserva` tiene `fechaInicio` y `fechaFin`
  reales, y la restricción de exclusión de Postgres opera sobre
  `tstzrange(fechaInicio, fechaFin)` filtrada a `CONFIRMADA`/`ESPERANDO_SENA`. En cuanto `fechaFin`
  varíe, el anti-superposición cubre solo los solapamientos parciales.
- **`TurnoFijo` y `Bloqueo` ya tienen `horaInicio` y `horaFin`**: las plantillas ya soportan
  duración arbitraria.
- **`disponibilidad.service.listar` usa el horario global**, no el de la cancha:
  `horarioDe(fecha, tz, cfg)` (definido en `disponibilidad.service.ts:15`) lee `Configuracion`.
  El modelo `HorarioDisponible` existe por cancha, el seed lo puebla y hay `horario.repo.ts` —
  pero la disponibilidad **no lo lee**. Queda fuera de alcance, anotado abajo.
- **`montoLista`** guarda el precio de lista cuando un socio reserva bonificado
  (`reserva.condiciones.ts:31-34`, `monto = 0`). El precio prorrateado debe alimentar tanto
  `monto` como `montoLista`.

### Dos defectos preexistentes que este trabajo corrige

1. **La franja pico que termina a medianoche nunca se aplica.** `precio.service.ts:16` compara
   strings:
   ```ts
   if (!desde || !hasta || desde >= hasta) return base;
   ```
   Con la banda 18–24, `hasta` es `"00:00"` y `"18:00" >= "00:00"` es **verdadero**, así que
   devuelve el precio base. El complejo cargaría 36.000 en el panel y cobraría 30.000 sin
   enterarse. `cierreMin()` sí sabe que `"00:00"` vale 1440, pero `precioEfectivo` no lo usa.
2. **Los turnos fijos de más de 1 hora se cobran como si fueran de 1.**
   `turnoFijo.service.ts:122` llama `precioEfectivo(fijo.cancha, fecha, fijo.horaInicio, cfg)`,
   que ignora `fijo.horaFin`. **Esto cambia plata en producción**: un turno fijo de 2 horas pasa a
   cobrar el doble de lo que cobra hoy. Es un arreglo, aprobado explícitamente por el usuario.
   Lo mismo aplica a `agenda.service.ts:40`, que muestra ese precio en la agenda.

   **Alcance preciso:** se corrige el **cálculo** del precio de los turnos fijos, que ya pueden
   durar más de una hora porque `TurnoFijo.horaInicio`/`horaFin` lo permiten. **No** se agrega un
   selector de duración a la UI de creación de turnos fijos: ese formulario ya define inicio y fin,
   y no hace falta tocarlo.

## Arquitectura

### 1. El cálculo de precio

Una función nueva reemplaza a `precioEfectivo`:

```
precioDeRango(cancha, fecha, horaInicio, duracionMin, cfg) → number
```

Calcula la intersección en minutos del rango `[inicio, inicio + duracionMin)` con la franja pico
del día (semana o finde según `dayOfWeekInTz`) y devuelve:

```
(minutosPico / 60) × precioHoraPico  +  (minutosBase / 60) × precioHora
```

Reglas heredadas de `precioEfectivo` que se conservan: si `precioHoraPico` no es mayor que 0, todo
el rango va a precio base; si la franja pico está vacía o mal definida, ídem.

**Corrección del bug de medianoche:** los bordes de la franja se normalizan a minutos con la misma
semántica de `cierreMin()` (`"00:00"` → 1440) antes de compararlos, en lugar de comparar strings.

Ejemplos con los precios del complejo (30.000 base / 36.000 pico, pico 18:00–00:00):

| Reserva | Cálculo | Total |
|---|---|---|
| 08:00, 60 min | 60 base | 30.000 |
| 08:00, 90 min | 90 base | 45.000 |
| 17:00, 120 min | 60 base + 60 pico | **66.000** |
| 19:00, 60 min | 60 pico | 36.000 |
| 22:30, 90 min | 90 pico | 54.000 |

`precioEfectivo` se elimina; sus cuatro consumidores pasan a `precioDeRango` con la duración que
corresponda (para `turnoFijo.service.ts`, la que sale de `horaInicio`/`horaFin`).

### 2. La duración en la reserva

- `Reserva` **no necesita columna nueva**: `fechaFin` ya existe.
- `crear` acepta `duracionMin` (60, 90 o 120) y lo usa para `fechaFin` y para los chequeos de
  conflicto, en lugar de `+60`. **Es opcional y su default es 60**, para que los dos clientes que
  hoy crean reservas sin conocer el campo — los workflows de n8n (`x-api-key`) y el bot de
  WhatsApp — sigan funcionando sin cambios. Un cliente viejo que no manda `duracionMin` obtiene
  exactamente el comportamiento actual.
- `reprogramar` y `moverDeCancha` preservan la duración de la reserva en lugar de asumir 1 hora.
- **Validación nueva:** la reserva debe terminar **antes o justo en el cierre**. Con cierre 00:00,
  la última de 2 h arranca 22:00 y la última de 1 h arranca 23:00. Hoy no existe ese chequeo
  porque todos los turnos medían lo mismo.
- La restricción de exclusión **no se toca**.

### 3. Disponibilidad

`SLOT_MIN` pasa de 60 a **30**, y el contrato del slot **se amplía de forma aditiva**.

Hoy `Grilla` es una matriz por hora (`horas: string[]`, `precios[canchaId][hora] = número`). Con
duración, el precio pasa a ser función de `(cancha, hora, duración)`, que esa matriz no expresa.

**La matriz no se elimina: se le agrega un campo al lado.** `precios[canchaId][hora]` no está mal,
está incompleto — es el precio de 60 minutos, y sigue siendo correcto. Manteniéndolo, el contrato
queda retrocompatible y la web pública sigue funcionando sin tocar una línea mientras el backend
ya sirve las duraciones nuevas.

Esto permite partir el trabajo en **dos planes independientes**, cada uno entregando software que
funciona por sí solo:

- **Plan A (backend):** precio prorrateado, duración en reservas, disponibilidad cada 30 minutos y
  `grilla` con el campo `duraciones` agregado. Mergeable y deployable solo: n8n, el bot de WhatsApp
  y la web pública siguen andando igual que hoy.
- **Plan B (frontends):** selector de duración en el panel y en la web pública, y calendario
  semanal con bloques proporcionales.

El campo nuevo, por cancha y hora, declara qué duraciones entran y cuánto sale cada una:

```jsonc
{
  "horaInicio": "17:00",
  "duraciones": [
    { "min": 60,  "horaFin": "18:00", "precio": 30000 },
    { "min": 90,  "horaFin": "18:30", "precio": 48000 },
    { "min": 120, "horaFin": "19:00", "precio": 66000 }
  ]
}
```

Una duración se publica solo si **(a)** termina antes o en el cierre y **(b)** no pisa ninguna
reserva `CONFIRMADA`/`ESPERANDO_SENA`, turno fijo ni bloqueo. Un slot sin ninguna duración viable
no se publica.

Consecuencia deliberada: **todo el cálculo de plata queda en el backend**, con una sola
implementación. La UI muestra lo que recibe; nadie recalcula precios en el browser.

Afecta a `disponibilidad.service.listar`, `listarPorTamano` y `grilla` (`disponibilidad.service.ts:72`),
esta última consumida por la web pública.

**Costo aceptado:** el paso de 60 a 30 minutos duplica la cantidad de slots en ambas grillas.

### 4. UI

Todo esto es **Plan B**; el backend (Plan A) se mergea antes y sin ello.

- **Web pública** (`reservas/src/components/pantalla-reserva.tsx`): elegido el horario, aparece el
  selector de duración con los precios que mandó el backend. `Grilla` en
  `reservas/src/lib/types.ts` suma el campo `duraciones`; los campos existentes no se tocan.
- **Panel**: el diálogo de nueva reserva suma el mismo selector.
- **Calendario semanal** (`frontend/src/components/calendario/calendario-semana.tsx` y
  `frontend/src/lib/calendario.ts`, que tiene tests): hoy dibuja una fila por hora; pasa a dibujar
  bloques de alto proporcional a la duración. **Es la parte más laboriosa del frontend** y no se
  puede evitar: sin eso una reserva de 2 horas se ve igual que una de 1 y el mostrador se confunde.

## Migración

**Ninguna.** No hace falta ni una migración de Prisma:

- `Reserva.fechaFin` ya existe y las reservas actuales ya tienen su fin correcto a +1 hora.
- `TurnoFijo` y `Bloqueo` ya tienen `horaInicio`/`horaFin`.
- Las duraciones `{60, 90, 120}` son una constante del código, no una tabla.
- Horario y pico siguen globales, así que `Configuracion` no cambia.

## Manejo de errores

- Duración fuera de `{60, 90, 120}` → `BadRequest` desde el validador zod.
- Reserva que termina después del cierre → `BusinessRule`.
- Solapamiento → lo detecta la restricción de exclusión y `reserva.repo.ts` lo convierte en
  `Conflict` (HTTP 409), como hoy. No se agrega chequeo previo: la regla del proyecto es dejar que
  la constraint dispare, nunca "consultar y después insertar".

## Verificación

El backend tiene suite real (vitest + Testcontainers) y ya existe `tests/unit/precio.service.test.ts`
sin Docker. Esta feature es aritmética de plata y lógica de solapamiento: **lleva tests propios, no
es negociable**. Como mínimo:

- **Unit** (`precio.service.test.ts`, sin Docker): las cinco filas de la tabla de ejemplos; el bug
  de medianoche (pico `18:00`–`00:00` **sí** se aplica a las 19:00); `precioHoraPico = 0` va todo a
  base; franja vacía o invertida va todo a base.
- **Integración** (con Docker): solapamiento parcial de 30 minutos rechazado con 409 por la
  restricción de exclusión; reserva que excede el cierre rechazada; `reprogramar` y `moverDeCancha`
  preservan la duración; un turno fijo de 2 horas materializa con el precio de 2 horas.
- `npm run typecheck` y `npm test` en `backend/`; `pnpm build` y `pnpm test` en `frontend/`;
  `pnpm build` en `reservas/`.

## Fuera de alcance

- **Descuentos por duración.** Confirmado que no existen. Si algún día el complejo quiere 2 horas a
  55.000 en vez de 60.000, hay que diseñar una tabla de precios por duración; hoy sería especular.
- **Horario y franja pico por cancha.** Confirmado que el complejo es uniforme. Queda anotado que
  `HorarioDisponible` existe por cancha, se puebla en el seed y **nadie lo lee** para disponibilidad:
  si algún día pádel y fútbol difieren, ese es el punto por donde entra.
- Duraciones configurables desde el panel.
- Cambios en el flujo de seña o de Mercado Pago.
