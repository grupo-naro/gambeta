# Liberar solo las reservas con seña vencida — Diseño

**Fecha:** 2026-08-06
**Estado:** Aprobado — listo para plan de implementación

## El problema

Un cliente reserva desde la web, lo mandamos a Mercado Pago y **abandona**: cierra la pestaña, le
falla el pago, o simplemente no le interesa. La reserva queda en `ESPERANDO_SENA`.

**Y ahí se queda para siempre.** Peor: **sigue bloqueando el horario**, porque la restricción de
exclusión de Postgres sobre `ReservaSector` cuenta `ESPERANDO_SENA` como ocupado. Cada cliente que
abandona el checkout deja una cancha muerta que nadie puede vender.

## Por qué no funciona el mecanismo que ya existe

El backend **ya sabe** cuáles vencieron:

- `reservaService.vencidasSena()` (`src/services/reserva.service.ts:386`) las lista usando
  `SENA_TIMEOUT_MINUTOS`, que vale **30** y el compose de la VM sí pasa al contenedor.
- `GET /reservas/vencidas-sena` (`src/routes/reserva.routes.ts:73`) las expone.

Pero **quien las cancelaba era un workflow de n8n** (`canchitas-timeout-se-a`, "cada 5 min libera
reservas cuya seña venció"), y **Gambeteando no usa n8n**: no tiene bot, solo el panel y la web de
reservas. Nadie llama a ese endpoint nunca.

O sea: el mecanismo está construido a medias. Falta el disparador.

> **Nota para quien lea el `CLAUDE.md`:** describe la topología de *canchitas*, con n8n, Evolution y
> el bot de WhatsApp. **Gambeteando no despliega n8n.** No asumas que hay un scheduler externo.

## Decisión tomada

**Un job interno del backend.** Revisa cada pocos minutos y cancela las vencidas por su cuenta, sin
depender de nada externo. Reusa `vencidasSena()`, que ya existe y ya está probada.

Se descartaron:
- **Liberar al consultar disponibilidad**: mete una escritura en un camino de lectura, y una reserva
  vencida sigue figurando ocupada hasta que alguien entre a mirar.
- **Las dos cosas**: más código y dos caminos que pueden cancelar la misma reserva a la vez.

## Diseño

Al arrancar la app, un intervalo que cada N minutos:

1. Pide las vencidas con la lógica que ya existe.
2. Las cancela con la misma transición de estado que usa el panel, para que **no haya un segundo
   camino de cancelación** con reglas propias.
3. Registra en el log cuántas liberó.

Puntos que la implementación tiene que resolver:

- **El camino de cancelación es `rechazarSena`, no `cancelar`.** El workflow de n8n llamaba a
  `PATCH /reservas/:id/rechazar-sena`, y hay un motivo de fondo para respetarlo: `cancelar()`
  (`reserva.service.ts:283`) exige `CANCELACION_ANTICIPACION_MINUTOS` de anticipación **salvo que
  haya `adminId`**. Un job no tiene admin, así que con `cancelar` fallarían justo las reservas más
  urgentes de liberar: las que están por empezar. `rechazarSena` no tiene esa restricción, y además
  deja el pago en `RECHAZADO` con `verificadoPor: 'IA'`, que es el mismo rastro que dejaba n8n.
- **Reusar esa cancelación, no escribir un UPDATE crudo.** `reservaRepo.updateEstado` actualiza
  `ReservaSector` **y** `Reserva` (`reserva.repo.ts:57-61`); es la actualización de los sectores la
  que libera el horario ante la restricción de exclusión. Un `UPDATE` directo sobre `Reserva`
  dejaría los sectores ocupados y el bug seguiría, más disimulado.
- **Idempotencia y concurrencia.** Si el admin aprueba la seña en el mismo instante en que el job la
  cancela, gana el que llegue primero y el otro no debe romper. `aprobarSena` ya maneja el 409 por
  carrera; la cancelación tiene que ser igual de tolerante.
- **No cancelar lo que no corresponde.** Solo `ESPERANDO_SENA` con la ventana vencida. Una reserva
  ya `CONFIRMADA`, `COMPLETADA` o `CANCELADA` no se toca.
- **Que no corra en los tests.** El job no debe arrancar durante la suite: ensuciaría estados y haría
  tests intermitentes. Arranca solo con la app real (`src/index.ts`), no al construir la app.

## Verificación

`vencidasSena()` ya tiene su lógica probada. Lo nuevo a cubrir:

- Una reserva `ESPERANDO_SENA` más vieja que el timeout se cancela.
- Una más nueva que el timeout **no** se cancela.
- Una `CONFIRMADA` vieja **no** se toca.
- **El horario vuelve a estar libre en `/disponibilidad` después de la cancelación** — es el punto
  entero de la feature y lo que hoy falla.
- Correr el job dos veces seguidas no rompe ni duplica nada.

## Cadencia

**Cada 2 minutos, como constante en el código.** El workflow de n8n corría cada 5; con 2 el turno se
libera entre los 30 y los 32 minutos, más cerca de lo que se pidió, y la consulta es chica.

No es una variable de entorno: `SENA_TIMEOUT_MINUTOS` ya es la perilla que decide el negocio, y
agregar una segunda repetiría el problema de Mercado Pago —declarada en `.env`, ausente de
`docker-compose.vm.yml`, silenciosamente vacía dentro del contenedor—.

## Fuera de alcance

- Avisarle al cliente que su reserva se liberó.
- Reintentar el cobro o recuperar el checkout abandonado.
- Cambiar `SENA_TIMEOUT_MINUTOS`, que ya vale 30 y es lo pedido.
- Reactivar o depender de n8n de cualquier forma.
