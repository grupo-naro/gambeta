-- AlterTable
ALTER TABLE "Cancha" ADD COLUMN     "precioHoraPico" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Configuracion" ADD COLUMN     "picoDesde" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "picoFindeDesde" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "picoFindeHasta" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "picoHasta" TEXT NOT NULL DEFAULT '';
