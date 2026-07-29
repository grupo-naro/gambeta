-- AlterTable
ALTER TABLE "Reserva" ADD COLUMN     "montoLista" DECIMAL(10,2),
ADD COLUMN     "suscripcionId" TEXT;

-- CreateIndex
CREATE INDEX "Reserva_suscripcionId_idx" ON "Reserva"("suscripcionId");

-- AddForeignKey
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_suscripcionId_fkey" FOREIGN KEY ("suscripcionId") REFERENCES "Suscripcion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
