-- CreateEnum
CREATE TYPE "TipoOrigen" AS ENUM ('WHATSAPP', 'QR', 'REDES', 'LANDING', 'DIRECTO', 'OTRO');

-- AlterTable
ALTER TABLE "Reserva" ADD COLUMN     "origenEtiqueta" TEXT,
ADD COLUMN     "origenTipo" "TipoOrigen";

-- CreateTable
CREATE TABLE "Visita" (
    "id" TEXT NOT NULL,
    "etiqueta" TEXT,
    "tipo" "TipoOrigen" NOT NULL,
    "sesionId" TEXT NOT NULL,
    "visitanteId" TEXT NOT NULL,
    "referer" TEXT,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visita_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Visita_sesionId_key" ON "Visita"("sesionId");

-- CreateIndex
CREATE INDEX "Visita_creadoEn_idx" ON "Visita"("creadoEn");

-- CreateIndex
CREATE INDEX "Visita_tipo_creadoEn_idx" ON "Visita"("tipo", "creadoEn");

-- CreateIndex
CREATE INDEX "Visita_etiqueta_creadoEn_idx" ON "Visita"("etiqueta", "creadoEn");
