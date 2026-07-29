-- CreateEnum
CREATE TYPE "SenaModo" AS ENUM ('PORCENTAJE', 'FIJO');

-- CreateTable
CREATE TABLE "Configuracion" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "horaApertura" TEXT NOT NULL DEFAULT '16:00',
    "horaCierre" TEXT NOT NULL DEFAULT '23:00',
    "adminWhatsapp" TEXT NOT NULL DEFAULT '',
    "senaModo" "SenaModo" NOT NULL DEFAULT 'PORCENTAJE',
    "senaPorcentaje" INTEGER NOT NULL DEFAULT 50,
    "senaMontoFijo" DECIMAL(10,2) NOT NULL DEFAULT 5000,
    "cbu" TEXT NOT NULL DEFAULT '',
    "alias" TEXT NOT NULL DEFAULT '',
    "titular" TEXT NOT NULL DEFAULT '',
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Configuracion_pkey" PRIMARY KEY ("id")
);
