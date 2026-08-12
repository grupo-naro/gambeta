# Elegir cómo pagar la seña: Mercado Pago o transferencia

## Problema

El sitio público cobra la seña de una sola forma: al confirmar, crea la reserva y manda derecho
al checkout de Mercado Pago. Quien no quiere o no puede pagar por ahí, no puede reservar online.

Además, esa dependencia es total: `getCobrosOnline()` consulta si hay una cuenta de Mercado Pago
vinculada y sana, y si no la hay el sitio **no toma ninguna reserva** — muestra "reservas cerradas"
y manda a WhatsApp. Una caída de Mercado Pago corta las reservas online por completo, aunque el
complejo tenga CBU y pueda cobrar por transferencia.

## Qué se construye

Al confirmar el turno, el cliente elige entre **Mercado Pago** y **transferencia**. Con Mercado
Pago, todo sigue igual. Con transferencia, se le muestran los datos bancarios y se le pide que
mande el comprobante por WhatsApp; ambos datos salen de la configuración que el admin edita en el
panel, no de constantes en el código.

## Decisiones tomadas

Cada una se decidió explícitamente durante el brainstorming. Se registran con su motivo para que
la implementación no las revierta por parecerle "más prolijo" otra cosa.

**El plazo de la seña no cambia: 30 minutos para los dos métodos.**
El job `liberarSenasVencidas` cancela toda reserva en `ESPERANDO_SENA` más vieja que
`SENA_TIMEOUT_MINUTOS` (default 30) y así libera el horario. Se evaluó darle a la transferencia
una ventana más larga y **se descartó**: el job no distingue el método y va a seguir sin hacerlo.
Consecuencia asumida: el cliente tiene ~30 minutos para transferir y mandar el comprobante, o el
turno se libera. `SENA_TIMEOUT_MINUTOS` es variable de entorno, así que el plazo se sube en el
compose sin tocar código — pero aplica a los dos métodos por igual.

**La reserva guarda con qué método se creó.**
Sin esto, en el panel una reserva esperando transferencia y una que abandonó el checkout de
Mercado Pago se ven idénticas, y no hay forma de saber a cuál le va a llegar un comprobante.

**Sin Mercado Pago el sitio sigue vendiendo, si hay datos de transferencia.**
La regla pasa a ser "¿hay al menos un método disponible?". Si no hay ninguno, recién ahí cierra:
ofrecer transferencia con el CBU vacío sería peor que cerrar.

**La elección es un segundo paso dentro del mismo modal**, no una pantalla aparte ni un campo más
en el formulario.

**El socio ve el paso de método y sigue de largo.**
No se sabe que el cliente es socio hasta después de crear la reserva. Se evaluó consultarlo por
teléfono antes y **se descartó** por no justificar un endpoint público nuevo y un round-trip. El
socio elige un método, la reserva vuelve confirmada y bonificada, y ve la pantalla de "¡Turno
confirmado!" de siempre.

**Se le avisa el plazo al cliente** en la pantalla de transferencia, tomado de
`SENA_TIMEOUT_MINUTOS`, nunca hardcodeado.

**Se muestra solo la cuenta principal** (`cbu` / `alias` / `titular`). La secundaria
(`cbu2` / `alias2` / `titular2`) existe para que el bot de WhatsApp valide comprobantes contra
cualquiera de las dos, no para ofrecerla como destino en la web.

## Backend

### Schema y migración

`Reserva` gana `metodoSena`, **nullable**:

```prisma
enum MetodoSena {
  MERCADO_PAGO
  TRANSFERENCIA
}
```

Nullable a propósito, y no con default: las reservas anteriores a este cambio, las que carga el
admin desde el panel y las de socio (que no pagan seña) no tienen método, y `null` es la lectura
honesta. Un default fabricaría un método que nadie eligió.

**Migración a mano.** La base de desarrollo tiene una deriva preexistente que hace que
`prisma migrate dev` pida un reset destructivo; no hay que aceptarlo. El procedimiento es el del
resto del proyecto: escribir el `.sql`, aplicarlo, y `prisma migrate resolve --applied`. Es
puramente aditiva (un tipo enum y una columna nullable).

### Crear la reserva

`POST /reservas` acepta `metodoSena` opcional en el body, validado con zod contra los dos valores
del enum.

**El backend lo descarta si la reserva no queda en `ESPERANDO_SENA`.** Si el cliente resulta socio
y la reserva sale `CONFIRMADA` y bonificada, guardar "iba a pagar por transferencia" sería
registrar una intención que nunca se va a ejecutar. La regla vive en el servicio, no en la ruta.

La condición es **el estado final de la reserva**, no el monto: si una reserva queda en
`ESPERANDO_SENA` con seña 0, el método se guarda igual. No hace falta un caso especial — el estado
ya dice si hay algo que cobrar.

### Los datos que el sitio necesita

`senaService.datosPago()` (que sirve a `GET /config/sena`) hoy devuelve
`{ modo, porcentaje, cbu, alias, titular, cobrosOnline }`. Gana tres campos:

| Campo | Qué es | Por qué |
|---|---|---|
| `adminWhatsapp` | `Configuracion.adminWhatsapp` | El número al que mandar el comprobante. Hoy no viaja al sitio. |
| `transferenciaDisponible` | `true` si `cbu` o `alias` no están vacíos | La regla de "¿se puede transferir?" vive en el backend, no duplicada en el sitio. |
| `senaTimeoutMinutos` | `SENA_TIMEOUT_MINUTOS` | Para avisarle el plazo al cliente sin hardcodearlo. |

`cobrosOnline` se mantiene con su significado actual (hay cuenta de Mercado Pago y está sana). No
se lo redefine: el sitio ahora combina los dos booleanos para decidir qué ofrecer, y renombrarlo
rompería a cualquier otro consumidor.

### Panel

El listado de reservas pendientes muestra el método elegido, para distinguir "espera un
comprobante por WhatsApp" de "abandonó el checkout". Sin método (`null`) no se muestra nada — no
se inventa una etiqueta para reservas que nunca eligieron.

## Sitio público (`reservas/`)

### La compuerta

`getCobrosOnline()` pasa a responder "¿hay al menos un método?": `cobrosOnline || transferenciaDisponible`.
El nombre de la función deja de describir lo que hace, así que se renombra a `getMetodosDisponibles()`
y devuelve los dos booleanos, que es lo que el modal necesita después.

`reservas-cerradas.tsx` se muestra solo cuando no hay ninguno de los dos.

### El modal, en dos pasos

**Paso 1** — igual que hoy: duración, nombre, teléfono, y la validación que ya existe. "Confirmar"
ya no crea la reserva: avanza al paso 2.

**Paso 2** — "¿Cómo querés pagar la seña?", con solo los métodos disponibles. Si hay uno solo, se
muestra igual como única opción, para que el cliente sepa qué va a pasar antes de tocar. Hay un
"Volver" al paso 1 — el cliente puede querer corregir el teléfono al ver que le van a pedir un
comprobante.

La reserva se crea **al elegir el método**, con `metodoSena` incluido. El manejo del rechazo por
concurrencia (otro cliente ocupó el turno) que hoy vive en `confirmar()` se mueve con la llamada:
vuelve al paso 1 con las duraciones recalculadas, como ahora.

- **Mercado Pago** → se crea la preferencia y se redirige al checkout, exactamente como hoy,
  incluido el fallback de "no pudimos generar el link de pago".
- **Transferencia** → pantalla de datos (abajo).

### Pantalla de transferencia

Se muestra dentro del mismo modal, después de crear la reserva:

- El resumen del turno, como en la pantalla de éxito actual.
- **El monto exacto de la seña**, que viene en `montoSena` de la reserva recién creada.
- Alias, CBU y titular, cada uno con botón de copiar — es lo que el cliente va a hacer igual.
- El pedido de mandar el comprobante al `adminWhatsapp`, como link `wa.me` si el número está
  cargado.
- El aviso del plazo, derivado de `senaTimeoutMinutos`.

**El monto de la seña no se puede mostrar en el paso 2**, antes de crear la reserva: la grilla no
lo expone y cada cancha puede tener su propio `senaMonto`, así que recién se conoce en la respuesta
de `POST /reservas`. Es el comportamiento que el sitio ya tiene hoy, no una regresión.

**Si `adminWhatsapp` está vacío**, la pantalla muestra los datos bancarios sin el pedido del
comprobante, en vez de un `wa.me/` roto o un texto que nombre un número inexistente. Es la misma
convención que ya sigue `negocio.ts` con los campos pendientes.

## Casos borde

| Caso | Qué pasa |
|---|---|
| Socio | Elige método, la reserva vuelve `CONFIRMADA` y bonificada, ve "¡Turno confirmado!". El método se descarta en el backend. |
| Seña 0 | No hay nada que cobrar: se muestra la pantalla de "te contactamos" actual, sin datos de transferencia. |
| Mercado Pago caído | El paso 2 ofrece solo transferencia. |
| Sin CBU ni alias | El paso 2 ofrece solo Mercado Pago. |
| Ninguno de los dos | El sitio no toma reservas: `reservas-cerradas.tsx`. |
| `adminWhatsapp` vacío | Datos bancarios sin el pedido de comprobante. |
| Turno ocupado mientras elegía | Vuelve al paso 1 con las duraciones recalculadas, como hoy. |

## Testing

**Backend (integración, Testcontainers):**
- `POST /reservas` con `metodoSena: 'TRANSFERENCIA'` lo persiste y `GET /reservas/:id` lo devuelve.
- `POST /reservas` sin `metodoSena` deja `null` — no rompe a los consumidores actuales.
- `metodoSena` inválido → 400.
- Una reserva de socio descarta el método: vuelve `CONFIRMADA` con `metodoSena` en `null`.
- `GET /config/sena` devuelve `adminWhatsapp`, `transferenciaDisponible` y `senaTimeoutMinutos`.
- `transferenciaDisponible` es `false` con `cbu` y `alias` vacíos, y `true` con cualquiera cargado.

**Sitio público:** no tiene setup de tests (`reservas/` no tiene vitest). La verificación es
manual, recorriendo los casos borde de la tabla.

## Fuera de alcance

- **Unificar las dos fuentes de número de WhatsApp.** La landing usa `reservas/src/lib/negocio.ts`
  (hardcodeado y hoy vacío, pendiente del cliente); esta feature usa `Configuracion.adminWhatsapp`.
  Quedan como dos fuentes distintas. Vale unificarlas, pero no acá.
- **Confirmar la transferencia automáticamente.** El admin sigue aprobando a mano con
  `PATCH /reservas/:id/aprobar-sena`, que ya existe. Cruzar el comprobante contra el movimiento
  bancario es trabajo del bot de WhatsApp, no de esto.
- **Ofrecer la cuenta secundaria** como destino en la web.
- **Darle a la transferencia una ventana de vencimiento propia.** Decidido y descartado arriba.
