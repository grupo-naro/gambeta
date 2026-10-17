-- Período de un bloqueo recurrente ("todos los jueves, desde X hasta Y"). Ambos extremos son
-- opcionales e inclusivos; null = sin límite. Solo tienen sentido en bloqueos recurrentes (un
-- bloqueo puntual ya tiene su fecha). Los bloqueos existentes quedan con null/null, es decir
-- exactamente como estaban: sin fecha de fin.
ALTER TABLE "Bloqueo" ADD COLUMN "vigenciaDesde" DATE;
ALTER TABLE "Bloqueo" ADD COLUMN "vigenciaHasta" DATE;
