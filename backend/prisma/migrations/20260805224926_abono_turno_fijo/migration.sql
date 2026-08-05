-- AlterTable
ALTER TABLE "Cobro" ADD COLUMN     "turnoFijoId" TEXT;

-- AlterTable
ALTER TABLE "TurnoFijo" ADD COLUMN     "montoAbono" DECIMAL(10,2),
ADD COLUMN     "vigenciaDesde" DATE,
ADD COLUMN     "vigenciaHasta" DATE;

-- CreateIndex
CREATE INDEX "Cobro_turnoFijoId_idx" ON "Cobro"("turnoFijoId");

-- AddForeignKey
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_turnoFijoId_fkey" FOREIGN KEY ("turnoFijoId") REFERENCES "TurnoFijo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
