-- Reserva: vínculo al turno fijo materializado (idempotente por fecha)
ALTER TABLE "Reserva" ADD COLUMN "turnoFijoId" TEXT;
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_turnoFijoId_fkey"
  FOREIGN KEY ("turnoFijoId") REFERENCES "TurnoFijo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Reserva_turnoFijoId_fechaInicio_key" ON "Reserva"("turnoFijoId", "fechaInicio");

-- TurnoFijo: el precio sale de la cancha; deja de ser obligatorio
ALTER TABLE "TurnoFijo" ALTER COLUMN "precio" DROP NOT NULL;
