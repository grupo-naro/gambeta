-- CreateEnum
CREATE TYPE "EstadoAlquiler" AS ENUM ('ENTREGADO', 'DEVUELTO', 'PERDIDO', 'ROTO');

-- AlterTable
ALTER TABLE "CajaBuffet" ADD COLUMN     "totalAlquileres" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "ArticuloAlquiler" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "prestado" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ArticuloAlquiler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alquiler" (
    "id" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "cajaId" TEXT NOT NULL,
    "articuloId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "quienRetira" TEXT NOT NULL,
    "garantia" TEXT,
    "precioUnit" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "medioPago" "MedioPago" NOT NULL,
    "montoPagado" DECIMAL(10,2) NOT NULL,
    "vuelto" DECIMAL(10,2) NOT NULL,
    "estado" "EstadoAlquiler" NOT NULL DEFAULT 'ENTREGADO',
    "entregadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradoEn" TIMESTAMP(3),

    CONSTRAINT "Alquiler_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Alquiler_uid_key" ON "Alquiler"("uid");

-- CreateIndex
CREATE INDEX "Alquiler_estado_idx" ON "Alquiler"("estado");

-- CreateIndex
CREATE INDEX "Alquiler_cajaId_idx" ON "Alquiler"("cajaId");

-- AddForeignKey
ALTER TABLE "Alquiler" ADD CONSTRAINT "Alquiler_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "CajaBuffet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alquiler" ADD CONSTRAINT "Alquiler_articuloId_fkey" FOREIGN KEY ("articuloId") REFERENCES "ArticuloAlquiler"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- La disponibilidad la garantiza la base, no el código: dos entregas concurrentes del mismo
-- artículo pueden ver ambas "queda 1". Mismo criterio que StockMostrador_cantidad_no_negativa.
ALTER TABLE "ArticuloAlquiler"
  ADD CONSTRAINT "ArticuloAlquiler_prestado_no_negativo" CHECK ("prestado" >= 0);
ALTER TABLE "ArticuloAlquiler"
  ADD CONSTRAINT "ArticuloAlquiler_prestado_no_supera_stock" CHECK ("prestado" <= "stock");
