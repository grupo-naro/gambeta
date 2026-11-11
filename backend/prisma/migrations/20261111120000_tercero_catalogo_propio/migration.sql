-- El tercero tiene su propio catálogo: productos, precios y stock independientes del principal.
-- ProductoBuffet.mostradorId NULL = catálogo general; si no, el mostrador dueño.
ALTER TABLE "ProductoBuffet" ADD COLUMN "mostradorId" TEXT;

-- El código de barras pasa a ser único por catálogo (la misma Coca puede estar en dos).
DROP INDEX "ProductoBuffet_codigoBarra_key";
CREATE UNIQUE INDEX "ProductoBuffet_codigoBarra_mostradorId_key" ON "ProductoBuffet"("codigoBarra", "mostradorId");
CREATE INDEX "ProductoBuffet_mostradorId_idx" ON "ProductoBuffet"("mostradorId");

ALTER TABLE "ProductoBuffet" ADD CONSTRAINT "ProductoBuffet_mostradorId_fkey"
  FOREIGN KEY ("mostradorId") REFERENCES "Mostrador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
