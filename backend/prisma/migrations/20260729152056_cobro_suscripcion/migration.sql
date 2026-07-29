-- AlterTable
ALTER TABLE "Cobro" ADD COLUMN     "suscripcionId" TEXT,
ALTER COLUMN "reservaId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Cobro_suscripcionId_idx" ON "Cobro"("suscripcionId");

-- AddForeignKey
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_suscripcionId_fkey" FOREIGN KEY ("suscripcionId") REFERENCES "Suscripcion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un cobro pertenece a una reserva O a una suscripcion, nunca a ambas ni a ninguna.
ALTER TABLE "Cobro" ADD CONSTRAINT cobro_destino_unico
  CHECK (("reservaId" IS NULL) <> ("suscripcionId" IS NULL));
