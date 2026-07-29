/*
  Warnings:

  - You are about to drop the column `cajaId` on the `VentaBuffet` table. All the data in the column will be lost.
  - You are about to drop the column `uid` on the `VentaBuffet` table. All the data in the column will be lost.
  - Added the required column `ticketId` to the `VentaBuffet` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "VentaBuffet" DROP CONSTRAINT "VentaBuffet_cajaId_fkey";

-- DropIndex
DROP INDEX "VentaBuffet_cajaId_idx";

-- DropIndex
DROP INDEX "VentaBuffet_uid_key";

-- AlterTable
ALTER TABLE "VentaBuffet" DROP COLUMN "cajaId",
DROP COLUMN "uid",
ADD COLUMN     "cantidad" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "ticketId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "TicketBuffet" (
    "id" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "cajaId" TEXT NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "medioPago" "MedioPago" NOT NULL,
    "montoPagado" DECIMAL(10,2) NOT NULL,
    "vuelto" DECIMAL(10,2) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketBuffet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketBuffet_uid_key" ON "TicketBuffet"("uid");

-- CreateIndex
CREATE INDEX "TicketBuffet_cajaId_idx" ON "TicketBuffet"("cajaId");

-- CreateIndex
CREATE INDEX "VentaBuffet_ticketId_idx" ON "VentaBuffet"("ticketId");

-- AddForeignKey
ALTER TABLE "TicketBuffet" ADD CONSTRAINT "TicketBuffet_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "CajaBuffet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaBuffet" ADD CONSTRAINT "VentaBuffet_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "TicketBuffet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
