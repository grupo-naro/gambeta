-- El check anterior solo contemplaba reserva O suscripcion. Con el abono de turnos fijos
-- (Task 1) un cobro puede pertenecer también a un turnoFijo, así que el check queda obsoleto:
-- rechaza el cobro de abono porque reservaId Y suscripcionId son ambos NULL.
-- Se reemplaza por "exactamente uno de los tres" en vez del XOR de dos columnas.
ALTER TABLE "Cobro" DROP CONSTRAINT cobro_destino_unico;

-- Un cobro pertenece a una reserva, a una suscripcion o a un turno fijo (abono): nunca a
-- combinación de dos, ni a ninguno.
ALTER TABLE "Cobro" ADD CONSTRAINT cobro_destino_unico
  CHECK (
    (("reservaId" IS NOT NULL)::int + ("suscripcionId" IS NOT NULL)::int + ("turnoFijoId" IS NOT NULL)::int) = 1
  );
