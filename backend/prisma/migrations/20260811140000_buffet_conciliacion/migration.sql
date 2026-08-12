-- CreateTable
-- Conteo físico al cerrar una caja del secundario. Guarda las cuatro cifras para poder mirar
-- el histórico y ver si el faltante es siempre del mismo producto.
CREATE TABLE "ConteoCierreLinea" (
    "id" TEXT NOT NULL,
    "cajaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "entregado" INTEGER NOT NULL,
    "vendido" INTEGER NOT NULL,
    "esperado" INTEGER NOT NULL,
    "contado" INTEGER NOT NULL,
    "diferencia" INTEGER NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConteoCierreLinea_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ConteoCierreLinea" ADD CONSTRAINT "ConteoCierreLinea_cajaId_fkey"
  FOREIGN KEY ("cajaId") REFERENCES "CajaBuffet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConteoCierreLinea" ADD CONSTRAINT "ConteoCierreLinea_productoId_fkey"
  FOREIGN KEY ("productoId") REFERENCES "ProductoBuffet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El índice único es lo que impide conciliar dos veces la misma caja: es un invariante de
-- base, no un chequeo de código.
CREATE UNIQUE INDEX "ConteoCierreLinea_cajaId_productoId_key" ON "ConteoCierreLinea"("cajaId", "productoId");
