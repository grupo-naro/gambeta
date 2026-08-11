-- CreateEnum
CREATE TYPE "TipoMostrador" AS ENUM ('PRINCIPAL', 'SECUNDARIO');

-- CreateTable
CREATE TABLE "Mostrador" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoMostrador" NOT NULL,
    "pinHash" TEXT NOT NULL DEFAULT '',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Mostrador_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Mostrador_tipo_key" ON "Mostrador"("tipo");

-- Los dos mostradores se crean acá, no en el seed: el backfill de más abajo necesita que el
-- principal exista, y una base sin mostradores dejaría el buffet inutilizable.
INSERT INTO "Mostrador" ("id", "nombre", "tipo", "pinHash")
SELECT 'mostrador-principal', 'Principal', 'PRINCIPAL', COALESCE((SELECT "buffetPinHash" FROM "Configuracion" WHERE id = 'default'), '');
INSERT INTO "Mostrador" ("id", "nombre", "tipo", "pinHash")
VALUES ('mostrador-secundario', 'Secundario', 'SECUNDARIO', '');

-- CajaBuffet pasa a pertenecer a un mostrador. Se agrega nullable, se rellena, y recién
-- después se vuelve obligatoria: si se creara NOT NULL de una, fallaría con filas existentes.
ALTER TABLE "CajaBuffet" ADD COLUMN "mostradorId" TEXT;
UPDATE "CajaBuffet" SET "mostradorId" = 'mostrador-principal' WHERE "mostradorId" IS NULL;
ALTER TABLE "CajaBuffet" ALTER COLUMN "mostradorId" SET NOT NULL;
ALTER TABLE "CajaBuffet" ADD CONSTRAINT "CajaBuffet_mostradorId_fkey"
  FOREIGN KEY ("mostradorId") REFERENCES "Mostrador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CajaBuffet_mostradorId_idx" ON "CajaBuffet"("mostradorId");

-- La unicidad de "caja abierta" pasa de GLOBAL a POR MOSTRADOR. Sin esto, abrir la caja del
-- secundario fallaría con P2002 porque el principal ya tiene una abierta.
DROP INDEX "CajaBuffet_una_abierta";
CREATE UNIQUE INDEX "CajaBuffet_una_abierta_por_mostrador"
  ON "CajaBuffet"("mostradorId") WHERE "estado" = 'ABIERTA'::"EstadoCajaBuffet";
