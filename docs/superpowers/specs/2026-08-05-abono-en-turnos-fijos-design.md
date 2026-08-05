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
| Al vencer el período | **Deja de generar turnos** | La cancha vuelve a estar disponible para otros. |
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

**Dentro del período** (`vigenciaDesde <= fecha <= vigenciaHasta`):
`materializar` crea la reserva con **`monto: 0`** y el precio real en **`montoLista`** — el mismo
par que usaba la bonificación de socios, para que la caja pueda informar cuánto se bonificó.

**Fuera del período:** no se materializa nada y **la cancha queda libre para otros**.

**Al crear el fijo con abono:** se genera un `Cobro` por `montoAbono`, con `origen: "ABONO"`,
`turnoFijoId` apuntando al fijo, y el medio de pago elegido (`EFECTIVO` o `TRANSFERENCIA`).

**Un abono vencido no desactiva el fijo.** El fijo queda `activo: true` pero inerte: no materializa
y no ocupa la cancha. Se decidió así para no confundir dos cosas distintas — `activo` significa
"este acuerdo existe", y el período significa "está pagado hasta acá". El panel muestra el rango en
la lista, así que un abono vencido se ve; no se agrega un estado nuevo ni un badge.

**Editar el abono de un fijo existente (`PATCH`) NO genera un cobro.** El cobro se crea una sola
vez, al dar de alta el fijo con abono. Si alguien corrige el monto o las fechas después, el cobro
original queda como está y cualquier ajuste de plata se hace a mano por caja. Automatizarlo
significaría decidir si se anula el cobro viejo, se emite una diferencia o se duplica, y ninguna de
las tres es obviamente correcta: es una decisión de negocio que nadie tomó todavía.

## Dónde impacta

El rango debe respetarse en **tres lugares que expanden turnos fijos por separado**. Es el riesgo
central de esta feature: son tres caminos independientes y olvidarse de uno no rompe nada visible.

| Lugar | Si se olvida |
|---|---|
| `turnoFijo.service.materializar` | Genera turnos fuera del abono. |
| `ocupacion.service.rangosPlantilla` | **La cancha figura ocupada para siempre.** Es lo que consultan la web pública y el bot de WhatsApp: vencido el abono el fijo deja de generar turnos, pero el horario nunca vuelve a venderse. **Es el más grave: se pierde plata en silencio**, porque nadie mira una celda que aparece ocupada. |
| `frontend/src/lib/calendario.ts` (`materializar`) | El calendario del panel sigue dibujando el fijo después de vencido. |

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
- Materializar una fecha fuera del período → `BusinessRule` (422), con el mismo criterio que los
  errores que ya existen (`'Ese turno fijo no aplica a esa fecha'`).
- Solapamiento con otra reserva → lo sigue atajando la restricción de exclusión de Postgres, que
  `reserva.repo.ts` convierte en `Conflict` (409). No se agrega chequeo previo.

## Verificación

El backend tiene suite real (vitest + Testcontainers). Esto es aritmética de plata y lógica de
rangos de fecha: lleva tests propios.

- Un turno dentro del período materializa con `monto: 0` y `montoLista` igual al precio real.
- Una fecha fuera del período **no** materializa.
- Después del vencimiento, **el horario vuelve a estar libre** en `/disponibilidad` — es el caso
  que protege contra la pérdida de plata silenciosa.
- El cobro del abono aparece en caja con `origen: "ABONO"`.
- **Regresión**: un fijo sin abono sigue cobrando el precio de la cancha, como hoy.

## Fuera de alcance

- **Renovar el abono.** Se carga un fijo nuevo con el período siguiente.
- Abonos parciales, en cuotas o pagados después de cargar el fijo.
- Reactivar la función de socios: sigue apagada detrás de su flag.
- Prorratear el abono si el período arranca a mitad de mes.
