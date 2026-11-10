-- Tercer puesto del buffet, igual que el secundario (cupo propio, caja propia).
-- El valor nuevo va en su propia migración: Postgres no deja usarlo en la misma transacción.
ALTER TYPE "TipoMostrador" ADD VALUE IF NOT EXISTS 'TERCERO';
