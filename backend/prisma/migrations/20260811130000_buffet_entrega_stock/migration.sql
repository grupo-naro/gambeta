-- CreateTable
-- Cuánto tiene asignado un mostrador de cada producto. Solo lo usa el SECUNDARIO: el stock
-- del principal es "ProductoBuffet.stock", que no se migra para no tocar a sus consumidores
-- (panel, alerta de stock bajo, planilla de Google).
CREATE TABLE "StockMostrador" (
    "mostradorId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "StockMostrador_pkey" PRIMARY KEY ("mostradorId", "productoId")
);
ALTER TABLE "StockMostrador" ADD CONSTRAINT "StockMostrador_mostradorId_fkey"
  FOREIGN KEY ("mostradorId") REFERENCES "Mostrador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMostrador" ADD CONSTRAINT "StockMostrador_productoId_fkey"
  FOREIGN KEY ("productoId") REFERENCES "ProductoBuffet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El stock asignado nunca puede quedar negativo. La garantía es de la base: el servicio hace
-- decrement dentro de una transacción, y sin esto una carrera entre dos ventas del mismo
-- producto lo dejaría en negativo sin que nada avise.
ALTER TABLE "StockMostrador" ADD CONSTRAINT "StockMostrador_cantidad_no_negativa" CHECK ("cantidad" >= 0);

-- CreateTable
-- Una entrega del principal al secundario: el "cuánto le di".
CREATE TABLE "EntregaMostrador" (
    "id" TEXT NOT NULL,
    "mostradorId" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conciliadaEnCajaId" TEXT,
    CONSTRAINT "EntregaMostrador_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "EntregaMostrador" ADD CONSTRAINT "EntregaMostrador_mostradorId_fkey"
  FOREIGN KEY ("mostradorId") REFERENCES "Mostrador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntregaMostrador" ADD CONSTRAINT "EntregaMostrador_conciliadaEnCajaId_fkey"
  FOREIGN KEY ("conciliadaEnCajaId") REFERENCES "CajaBuffet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "EntregaMostrador_mostradorId_conciliadaEnCajaId_idx" ON "EntregaMostrador"("mostradorId", "conciliadaEnCajaId");

-- CreateTable
CREATE TABLE "EntregaMostradorLinea" (
    "id" TEXT NOT NULL,
    "entregaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    CONSTRAINT "EntregaMostradorLinea_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "EntregaMostradorLinea" ADD CONSTRAINT "EntregaMostradorLinea_entregaId_fkey"
  FOREIGN KEY ("entregaId") REFERENCES "EntregaMostrador"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntregaMostradorLinea" ADD CONSTRAINT "EntregaMostradorLinea_productoId_fkey"
  FOREIGN KEY ("productoId") REFERENCES "ProductoBuffet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
