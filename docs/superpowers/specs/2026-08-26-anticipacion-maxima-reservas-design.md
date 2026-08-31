# Anticipación máxima: el sitio público reserva hasta una semana adelante

## Problema

Hoy **no hay ningún techo** sobre cuán lejos se puede reservar, en ninguna capa:

- `reservas/src/components/calendario.tsx` recibe solo `min`. No existe `max`, y las flechas de
  mes navegan hacia adelante sin fin.
- `reservas/src/components/selector-fecha-mobile.tsx` muestra el mes actual y el siguiente
  **completos**.
- `Configuracion` no tiene ningún campo de anticipación, y `reserva.service.crear` solo valida
  que la fecha no esté en el pasado.

La consecuencia concreta: el miércoles 26/08/2026 un cliente puede reservar para el 9 de
septiembre, catorce días adelante. El complejo quiere que la agenda pública se abra de a poco,
no que se llene con meses de anticipación.

## Qué se construye

Un techo de anticipación configurable, que aplica **solo a las reservas del público** y se
refleja en el calendario del sitio para que el cliente no vea siquiera lo que no puede elegir.

## Lo que decidió el negocio

Cada punto se decidió explícitamente durante el brainstorming; se registran con su motivo para
que la implementación no los revierta.

**Ventana móvil de 7 días, no semana calendario.** Se puede reservar desde hoy hasta
`hoy + diasAnticipacionMax` **inclusive** — con el default de 7 y hoy miércoles 26/08, el último
día reservable es el miércoles 02/09, y mañana jueves 27 la ventana se corre hasta el jueves 03.
La alternativa (cerrar el domingo y abrir la semana entera el lunes) se descartó porque le da
anticipación distinta a cada cliente según qué día entre: el que consulta un sábado se queda
casi sin margen.

**El staff no tiene límite.** El que atiende el teléfono tiene que poder anotar a alguien para
dentro de dos semanas. El backend ya distingue quién llama, así que la regla se aplica solo
cuando la reserva **no** la carga un admin.

**El valor vive en `Configuracion`, editable desde el panel.** Es la convención del repo
(`CLAUDE.md`: lo que el admin edita en caliente va en `Configuracion`, junto a horarios y reglas
de seña), y es previsible que el dueño quiera abrir dos semanas para un torneo sin esperar un
deploy. Se descartaron la variable de entorno (exige reiniciar el contenedor y no es
autoservicio) y la constante en código (exige commit + deploy).

**El mensaje de error nombra la fecha, no la cantidad de días.** "Por ahora solo se puede
reservar hasta el 02/09" se entiende sin hacer cuentas; "hasta 7 días de anticipación" no.

## Supuesto pendiente de confirmación

El sitio público y el bot de WhatsApp de n8n **comparten la misma clave de servicio**
(`authAny`). Como el límite se aplica por tipo de llamador, **el bot también queda limitado a 7
días**.

Se asume que está bien: es el mismo público entrando por otra puerta, y sería incoherente que el
sitio corte a 7 días y el bot acepte 30. Si el negocio quiere que el bot cargue más lejos, hay
que darle una clave propia y distinguirla del sitio — eso cambia el diseño y **no** está cubierto
acá.

## El cálculo del límite

El límite es una **fecha calendario en `TZ_NEGOCIO`**, no un delta de milisegundos.

```
hoy       = hoyEnTz(tz)                         // "2026-08-26"
limiteYmd = sumarDias(hoy, diasAnticipacionMax) // "2026-09-02", aritmetica de calendario
finLimite = dayWindowUtc(limiteYmd, tz).end     // instante UTC del fin de ese dia

rechazar si  fechaInicio >= finLimite
```

Sumar `7 * 86400000` a `Date.now()` daría un instante, no un día, y dejaría el último día
reservable partido al medio: a las 20:00 de hoy el corte caería a las 20:00 del día 7, y los
turnos de 21:00 y 22:00 de ese día quedarían rechazados sin motivo visible.

`dayWindowUtc` ya existe en `backend/src/utils/tz.ts`. `hoyEnTz` y `sumarDias` **no existen y hay
que agregarlos ahí**. Existe un `ymdEnTz` que hace parte del trabajo, pero vive en
`services/sheets/sheetsData.ts` — el módulo de sincronización con Google Sheets — y no es de
donde una regla de reservas debe sacar su aritmética de fechas. Los dos helpers nuevos son de dos
líneas cada uno y `utils/tz.ts` es su lugar natural, junto a los otros cuatro.

## Modelo de datos

Un campo en el singleton `Configuracion`:

```prisma
model Configuracion {
  // ...
  /// Cuántos días adelante puede reservar el público. El staff no tiene techo.
  /// La ventana es móvil e inclusiva: hoy .. hoy + este valor.
  diasAnticipacionMax Int @default(7)
}
```

Migración: `npx prisma migrate dev --name anticipacion_max`. El default cubre la fila existente
sin backfill.

## Backend

### `utils/tz.ts`

Dos helpers nuevos, junto a los cuatro que ya viven ahí:

```ts
/** El día de hoy en la zona del negocio, como "YYYY-MM-DD". */
export function hoyEnTz(timeZone: string): string

/** Suma días a un "YYYY-MM-DD" con aritmética de calendario, no de milisegundos. */
export function sumarDias(date: string, dias: number): string
```

### `services/reserva.service.ts`

La regla va en `crear`, **pegada a la validación de "no se puede reservar en el pasado"** que ya
vive en la línea 73 — son la misma clase de chequeo (¿la fecha cae en la ventana permitida?) y
separarlas invita a que la segunda se olvide en un refactor.

```ts
if (fechaInicio.getTime() <= Date.now()) throw BusinessRule('No se puede reservar en el pasado');
if (!opts.porStaff) {
  // ... calculo de finLimite segun la seccion anterior
  if (fechaInicio >= finLimite) throw BusinessRule(`Por ahora solo se puede reservar hasta el ${ddmm}`);
}
```

`opts.porStaff` **ya existe** en la firma de `crear`, y `reserva.routes.ts:30` ya lo calcula como
`req.principal?.kind === 'admin'`. No hay que agregar ningún parámetro ni tocar la ruta.

### `services/sena.service.ts`

`DatosPago` suma `diasAnticipacionMax: number`, tomado de `configService.get()`. Viaja por el
`GET /config/sena` que el sitio público **ya consulta en cada carga** para decidir si hay métodos
de pago: **no se crea ningún endpoint nuevo**.

### `validators/config.schema.ts`

```ts
diasAnticipacionMax: z.coerce.number().int().min(1).max(365).optional(),
```

`min(1)` porque 0 dejaría reservar solo el día en curso, que en la práctica apaga el sitio y es
más fácil de conseguir por accidente que a propósito.

## Sitio de reservas

- **`lib/types.ts` + `lib/actions.ts`** — `MetodosPago` suma el campo. `getMetodosPago` ya cae a
  un objeto vacío cuando el backend no responde: ahí el default es `7`, no `0`, para que una
  caída del API no apague el calendario entero.
- **`app/page.tsx`** — pasa el valor a `PantallaReserva`.
- **`components/calendario.tsx`** — nueva prop `max`, hermana de la `min` que ya tiene; los días
  posteriores se deshabilitan con el mismo tratamiento visual. Además **se cortan las flechas de
  mes** cuando el mes siguiente cae entero fuera de la ventana: navegar a octubre y encontrar 31
  días grises es peor experiencia que no poder navegar.
- **`components/selector-fecha-mobile.tsx`** — deja de listar dos meses completos y lista solo los
  días de la ventana. Con 7 días son 8 chips, y las pastillas de mes solo tienen sentido cuando la
  ventana cruza de mes.
- **`components/pantalla-reserva.tsx`** — pasa `max` a los dos selectores, y si la fecha
  seleccionada quedó fuera de la ventana (pestaña abierta de un día para el otro) la corrige a hoy
  antes de pedir la grilla.

## Panel

- **`components/config/config-form.tsx`** — un input numérico, "Anticipación máxima del sitio
  público (días)", junto al resto de los ajustes de reserva.
- La server action de configuración suma el campo al payload.

El calendario del panel **no** se toca: el staff no tiene techo.

## Tests

Integración (`backend/tests/integration/`), que es donde se puede ejercitar el tipo de llamador:

1. Con `x-api-key`, fecha dentro de la ventana → **201**.
2. Con `x-api-key`, fecha un día después del límite → **422** `BusinessRule`.
3. Con JWT de admin, esa misma fecha lejana → **201**. Es el test que protege al mostrador.
4. Con `diasAnticipacionMax` cambiado en `Configuracion`, la ventana se mueve — prueba que el
   valor se lee de la config y no está hardcodeado.

Unitario: el cálculo del límite en `TZ_NEGOCIO`, incluyendo el caso "turno a las 22:00 del último
día de la ventana", que es el que rompería una implementación basada en milisegundos.

`resetTables()` no necesita cambios: no hay modelos nuevos.

## Fuera de alcance

- **`disponibilidad.service.ts` no se toca.** Si alguien pide la grilla de un día lejano se la
  damos igual; lo que se corta es *crear* la reserva. Cortar también la grilla rompería el panel,
  que usa el mismo endpoint sin límite.
- **Anticipación mínima** ("no se puede reservar con menos de X horas"). No se pidió.
- **Ventana por cancha o por deporte.** El techo es único para todo el complejo.
- **Darle al bot de WhatsApp una clave propia** para eximirlo del límite. Ver el supuesto
  pendiente más arriba.
