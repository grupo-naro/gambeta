-- Las tres consultas de `analyticsService.origenes()` filtran siempre por rango sobre
-- "creadoEn" y agrupan por "tipo" o por ("etiqueta", "tipo"). Los índices anteriores tenían
-- la columna del rango en segunda posición, que Postgres no usa para un rango sin predicado
-- en la columna líder. Se reemplazan por índices con "creadoEn" primero -- que además
-- subsumen al índice simple por "creadoEn" -- y "visitanteId" al final para permitir
-- index-only scan en el COUNT(DISTINCT "visitanteId").

-- DropIndex
DROP INDEX "Visita_creadoEn_idx";

-- DropIndex
DROP INDEX "Visita_tipo_creadoEn_idx";

-- DropIndex
DROP INDEX "Visita_etiqueta_creadoEn_idx";

-- CreateIndex
CREATE INDEX "Visita_creadoEn_tipo_visitanteId_idx" ON "Visita"("creadoEn", "tipo", "visitanteId");

-- CreateIndex
CREATE INDEX "Visita_creadoEn_etiqueta_tipo_visitanteId_idx" ON "Visita"("creadoEn", "etiqueta", "tipo", "visitanteId");
