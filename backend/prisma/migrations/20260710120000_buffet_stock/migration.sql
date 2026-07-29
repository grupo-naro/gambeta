-- CreateEnum
CREATE TYPE "EstadoCajaBuffet" AS ENUM ('ABIERTA', 'CERRADA');

-- CreateTable
CREATE TABLE "ProductoBuffet" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigoBarra" TEXT,
    "precio" DECIMAL(10,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "stockMinimo" INTEGER NOT NULL DEFAULT 0,
    "enBotonera" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ProductoBuffet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CajaBuffet" (
    "id" TEXT NOT NULL,
    "abiertaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradaEn" TIMESTAMP(3),
    "estado" "EstadoCajaBuffet" NOT NULL DEFAULT 'ABIERTA',
    "totalUnidades" INTEGER,
    "totalMonto" DECIMAL(10,2),
    CONSTRAINT "CajaBuffet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VentaBuffet" (
    "id" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "cajaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "precioUnit" DECIMAL(10,2) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VentaBuffet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductoBuffet_codigoBarra_key" ON "ProductoBuffet"("codigoBarra");
CREATE UNIQUE INDEX "VentaBuffet_uid_key" ON "VentaBuffet"("uid");
CREATE INDEX "VentaBuffet_cajaId_idx" ON "VentaBuffet"("cajaId");

-- Una sola caja ABIERTA a la vez, garantizado por la base (Prisma no sabe expresar
-- indices parciales; si esto falla, es que hay dos cajas abiertas y hay un bug).
CREATE UNIQUE INDEX "CajaBuffet_una_abierta" ON "CajaBuffet"(("estado")) WHERE "estado" = 'ABIERTA'::"EstadoCajaBuffet";

-- AddForeignKey
ALTER TABLE "VentaBuffet" ADD CONSTRAINT "VentaBuffet_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "CajaBuffet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VentaBuffet" ADD CONSTRAINT "VentaBuffet_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "ProductoBuffet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Configuracion" ADD COLUMN "buffetPinHash" TEXT NOT NULL DEFAULT '';
