-- CreateEnum
CREATE TYPE "MetodoSena" AS ENUM ('MERCADO_PAGO', 'TRANSFERENCIA');

-- AlterTable
-- Nullable y sin default: no hay nada que rellenar. Las reservas existentes no eligieron método.
ALTER TABLE "Reserva" ADD COLUMN "metodoSena" "MetodoSena";
