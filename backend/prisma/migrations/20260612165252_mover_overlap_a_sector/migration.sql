ALTER TABLE "Reserva" DROP CONSTRAINT IF EXISTS reserva_no_overlap;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "ReservaSector"
  ADD CONSTRAINT reservasector_no_overlap
  EXCLUDE USING gist (
    "sectorId" WITH =,
    tstzrange("fechaInicio", "fechaFin") WITH &&
  )
  WHERE (estado IN ('CONFIRMADA'::"EstadoReserva", 'ESPERANDO_SENA'::"EstadoReserva"));
