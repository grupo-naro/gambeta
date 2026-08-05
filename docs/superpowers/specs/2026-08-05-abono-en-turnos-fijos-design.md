# Abono en turnos fijos — Diseño

**Fecha:** 2026-08-05
**Estado:** Aprobado

## Objetivo

Que un turno fijo pueda tener un **abono**: un período (desde/hasta) y un monto que el cliente paga
una sola vez por todo ese período. Dentro del período, cada turno que se materializa sale **$0**.

Reemplaza a la función de **socios** (suscripciones), desactivada en el commit `3c2fa62`. El
complejo maneja a sus socios con turnos fijos, no con suscripciones: esta feature le da al turno
fijo lo único que le faltaba para cumplir ese rol.

## Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Qué representa el monto | **Un abono**: paga el período, los turnos salen 0 | Es el reemplazo directo de la suscripción. |
| Cobro | **Se registra al cargar el abono** | Sin esto la plata no aparece en caja: los turnos salen 0 y el ingreso se perdería. |
| Al vencer el período | **Sigue generando turnos, en $0, con aviso de renovar** | El horario sigue siendo del cliente: no pierde su lugar de siempre por atrasarse unos días. El período no controla nada, solo enciende un aviso. |
| Campos del abono | **Opcionales** | Un fijo sin ellos se comporta exactamente como hoy. Restricción, no elección: hacerlos obligatorios rompería todos los fijos existentes. |
| Renovar | **Fuera de alcance** | Se carga un fijo nuevo con el período siguiente. Si resulta frecuente, se agrega después. |

## Contexto (estado actual)

- **`TurnoFijo`** tiene `canchaId`, `clienteNombre`, `whatsapp?`, `diaSemana`, `horaInicio`,
  `horaFin`, `precio?`, `activo`, `excepciones[]`. **No tiene ninguna noción de vigencia**: un fijo
  vale para siempre hasta que se desactiva.
- **`turnoFijo.service.materializar(fijoId, fecha)`** crea la `Reserva` de una fecha concreta.
  Calcula el precio con `precioDeRango(fijo.cancha, ...)` y **no crea ningún `Cobro`**: la plata se
  registra después por caja.
- **`TurnoFijo.precio` no se usa para nada.** Solo se lee para mostrarlo en la lista
  (`turnoFijo.service.ts:99`); `materializar` lo ignora y toma el precio de la cancha. Es un campo
  muerto.
- **`Cobro.origen` es un `String` libre** con default `"MANUAL"` (valores en uso: `MANUAL`, `SENA`,
  `SUSCRIPCION`), **no un enum**: agregar `"ABONO"` no necesita migración de tipo.
- **`Cobro` solo puede apuntar a una reserva o a una suscripción** (`reservaId?`,
  `suscripcionId?`). No hay forma de colgar un cobro de un turno fijo.
- **`caja.service` ya es defensivo con cobros sin reserva** (usa `c.reserva?.cancha`), así que un
  cobro de abono entra sin cambios.
- **Socios quedó apagado detrás de un flag** (`backend/src/config/features.ts`,
  `SOCIOS_HABILITADO = false`). El mecanismo de bonificación que usaba —`monto: 0` +
  `montoLista: precio` en `resolverCondiciones`— **sigue existiendo y es el que reutiliza el abono**.

## Modelo de datos

**`TurnoFijo` suma tres campos, los tres opcionales:**

```prisma
vigenciaDesde  DateTime?  @db.Date   // inicio del abono
vigenciaHasta  DateTime?  @db.Date   // fin del abono, INCLUSIVE
montoAbono     Decimal?   @db.Decimal(10, 2)
```

Los tres van juntos: o están los tres o no está ninguno. Un fijo sin ellos es perpetuo y cobra por
turno, **exactamente como hoy**. Ninguna fila existente necesita migración de datos.

**`Cobro` suma un campo:**

```prisma
turnoFijoId String?
turnoFijo   TurnoFijo? @relation(fields: [turnoFijoId], references: [id], onDelete: Restrict)
```

Sin esto el cobro del abono quedaría huérfano, sin nada que lo vincule al fijo que lo originó.

**`TurnoFijo.precio` queda marcado como obsoleto** con un comentario en el esquema. **No se
reutiliza para el abono**: significan cosas distintas (precio por turno vs. monto del período) y
mezclarlas dejaría un campo con dos sentidos según el contexto. No se borra para no romper la
lista que ya lo muestra.

Es **una sola migración** de Prisma, con los cuatro campos.

## Comportamiento

**Un fijo con abono materializa siempre en `monto: 0`**, con el precio real en `montoLista` — el
mismo par que usaba la bonificación de socios, para que la caja pueda informar cuánto se bonificó.

**El período NO es una compuerta.** Vencido el abono, el fijo sigue generando turnos en $0 y sigue
ocupando la cancha: el horario sigue siendo del cliente y no lo pierde por atrasarse unos días.
Lo único que cambia es que se enciende un **aviso de abono vencido**.

Esto es una decisión deliberada y tiene una consecuencia que hay que tener presente: **el único
freno es que alguien mire el aviso.** No se genera deuda ni se bloquea nada. Si el cliente no
renueva y nadie lo nota, sigue jugando sin pagar por tiempo indefinido. Por eso el aviso tiene que
ser prominente, no un texto gris al costado.

Consecuencia técnica importante: como el período no controla la generación, **no hay que tocar
`ocupacion.service.rangosPlantilla` ni el calendario del panel**. Una versión anterior de este
diseño hacía que el fijo dejara de generar turnos al vencer, lo que obligaba a filtrar por rango en
tres lugares independientes; el riesgo principal era olvidarse en `rangosPlantilla` y dejar la
cancha ocupada para siempre. Con esta decisión ese riesgo desaparece.

**Al crear el fijo con abono:** se genera un `Cobro` por `montoAbono`, con `origen: "ABONO"`,
`turnoFijoId` apuntando al fijo, y el medio de pago elegido (`EFECTIVO` o `TRANSFERENCIA`).

**Un abono vencido no desactiva el fijo ni lo detiene.** El fijo sigue `activo: true` y sigue
funcionando igual: genera turnos y ocupa la cancha. Los dos conceptos son distintos y quedan
separados a propósito — `activo` significa "este acuerdo existe" y el período significa "está
pagado hasta acá". Para dejar de generar turnos hay que desactivar el fijo, como siempre.

**Editar el abono de un fijo existente (`PATCH`) NO genera un cobro.** El cobro se crea una sola
vez, al dar de alta el fijo con abono. Si alguien corrige el monto o las fechas después, el cobro
original queda como está y cualquier ajuste de plata se hace a mano por caja. Automatizarlo
significaría decidir si se anula el cobro viejo, se emite una diferencia o se duplica, y ninguna de
las tres es obviamente correcta: es una decisión de negocio que nadie tomó todavía.

## Dónde impacta

**No se toca la disponibilidad.** Ni `ocupacion.service.rangosPlantilla`, ni el calendario del
panel, ni la web pública, ni el bot de WhatsApp: el fijo ocupa la cancha igual que hoy, vencido o
no. Toda la superficie del cambio es el alta del abono y el aviso.

### El aviso de abono vencido

Un fijo está vencido cuando tiene abono cargado y `vigenciaHasta < hoy` (en `TZ_NEGOCIO`).

- **Pantalla Hoy** (`frontend/src/components/hoy/`): es la vista que mira recepción durante el
  turno, y es donde el usuario pidió el aviso. La tarjeta del turno muestra de forma prominente que
  el abono está vencido y desde cuándo. Prominente en serio: es el único control que existe, así
  que va con color de alerta y no como texto secundario.
- **Lista de turnos fijos**: marca cuáles están vencidos, para ver de un vistazo quién tiene que
  renovar sin depender de cruzarse el turno.

**El backend expone el dato, no la decisión.** La API devuelve `vigenciaHasta` y las pantallas
derivan el estado, en vez de que cada una recalcule qué significa "vencido" con su propio criterio.

**Resto de la superficie:**

- **Validador zod** (`turnoFijo.schema.ts`): si viene uno de los tres campos del abono, tienen que
  venir los tres; y `vigenciaDesde <= vigenciaHasta`. El medio de pago es obligatorio cuando hay
  abono.
- **Formulario del panel** (`frontend/src/components/fijos/`): suma desde, hasta, monto y medio,
  ocultos salvo que se active el abono.
- **API de turnos fijos**: expone los tres campos nuevos, porque el calendario del panel los
  necesita para filtrar.
- **Caja y analíticas**: el cobro con `origen: "ABONO"` entra solo, sin cambios.

## Manejo de errores

- Campos del abono incompletos, o `vigenciaDesde > vigenciaHasta` → `BadRequest` desde zod.
- Materializar fuera del período **no es un error**: el fijo genera el turno igual, en $0, y la
  pantalla Hoy muestra el aviso. Los errores de materialización que ya existen (fecha que no cae en
  el día del fijo, fecha liberada por excepción, fijo inactivo) no cambian.
- Solapamiento con otra reserva → lo sigue atajando la restricción de exclusión de Postgres, que
  `reserva.repo.ts` convierte en `Conflict` (409). No se agrega chequeo previo.

## Verificación

El backend tiene suite real (vitest + Testcontainers). Esto es aritmética de plata y lógica de
rangos de fecha: lleva tests propios.

- Un turno dentro del período materializa con `monto: 0` y `montoLista` igual al precio real.
- Un turno **posterior** al vencimiento **también** materializa en `monto: 0`: el abono vencido no
  cambia el precio, solo enciende el aviso.
- El horario **sigue ocupado** en `/disponibilidad` después del vencimiento — un tercero no puede
  tomarlo. Es la contracara de la decisión y conviene tenerla cubierta por un test.
- El cobro del abono aparece en caja con `origen: "ABONO"`.
- **Regresión**: un fijo sin abono sigue cobrando el precio de la cancha, como hoy.

## Fuera de alcance

- **Renovar el abono.** Se carga un fijo nuevo con el período siguiente.
- Abonos parciales, en cuotas o pagados después de cargar el fijo.
- Reactivar la función de socios: sigue apagada detrás de su flag.
- Prorratear el abono si el período arranca a mitad de mes.
