CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Reserva"
  ADD CONSTRAINT reserva_no_overlap
  EXCLUDE USING gist (
    "canchaId" WITH =,
    tstzrange("fechaInicio", "fechaFin") WITH &&
  )
  WHERE (estado IN ('CONFIRMADA'::"EstadoReserva", 'ESPERANDO_SENA'::"EstadoReserva"));
