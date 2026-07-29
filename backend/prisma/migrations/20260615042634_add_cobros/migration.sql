-- CreateEnum
CREATE TYPE "MedioPago" AS ENUM ('EFECTIVO', 'TRANSFERENCIA');

-- CreateTable
CREATE TABLE "Cobro" (
    "id" TEXT NOT NULL,
    "reservaId" TEXT NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "medio" "MedioPago" NOT NULL,
    "origen" TEXT NOT NULL DEFAULT 'MANUAL',
    "registradoPorId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cobro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cobro_creadoEn_idx" ON "Cobro"("creadoEn");

-- CreateIndex
CREATE INDEX "Cobro_reservaId_idx" ON "Cobro"("reservaId");

-- AddForeignKey
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "Reserva"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
