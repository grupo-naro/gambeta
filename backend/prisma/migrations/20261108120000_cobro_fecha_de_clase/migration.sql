-- Un entrenamiento recurrente (bloqueo) tiene un valor POR CLASE: cada cobro se ata a la fecha de la
-- clase que paga. En los eventos puntuales queda null.
ALTER TABLE "Cobro" ADD COLUMN "bloqueoFecha" DATE;
