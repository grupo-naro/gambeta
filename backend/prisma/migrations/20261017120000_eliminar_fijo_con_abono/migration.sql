-- Permitir eliminar un turno fijo que tiene abono cobrado, conservando el cobro en la caja.
--
-- Antes la FK era RESTRICT: borrar el fijo estaba bloqueado para no perder el rastro del
-- ingreso. Ahora el cobro sobrevive al fijo: la FK pasa a SET NULL y el cobro queda "huérfano"
-- (sin reserva, suscripción ni fijo) pero marcado con origen = 'ABONO', que es lo que la caja
-- usa para seguir contándolo como abono.
ALTER TABLE "Cobro" DROP CONSTRAINT "Cobro_turnoFijoId_fkey";
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_turnoFijoId_fkey"
  FOREIGN KEY ("turnoFijoId") REFERENCES "TurnoFijo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Un cobro pertenece a exactamente uno de los tres destinos, salvo el abono de un fijo ya
-- eliminado: ese queda sin destino y solo se admite con origen = 'ABONO'. Sin esta excepción el
-- SET NULL de arriba violaría el CHECK y el borrado fallaría.
ALTER TABLE "Cobro" DROP CONSTRAINT cobro_destino_unico;
ALTER TABLE "Cobro" ADD CONSTRAINT cobro_destino_unico
  CHECK (
    (("reservaId" IS NOT NULL)::int + ("suscripcionId" IS NOT NULL)::int + ("turnoFijoId" IS NOT NULL)::int) = 1
    OR (
      "reservaId" IS NULL AND "suscripcionId" IS NULL AND "turnoFijoId" IS NULL
      AND "origen" = 'ABONO'
    )
  );
