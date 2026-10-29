-- CreateEnum
CREATE TYPE "EstadoCuentaBuffet" AS ENUM ('ABIERTA', 'RENDIDA', 'CANCELADA', 'IMPAGA');

-- CreateTable
CREATE TABLE "CuentaBuffet" (
    "id" TEXT NOT NULL,
    "mostradorId" TEXT NOT NULL,
    "canchaId" TEXT NOT NULL,
    "reservaId" TEXT,
    "estado" "EstadoCuentaBuffet" NOT NULL DEFAULT 'ABIERTA',
    "abiertaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradaEn" TIMESTAMP(3),
    "cajaId" TEXT,
    "ticketId" TEXT,
    "total" DECIMAL(10,2),

    CONSTRAINT "CuentaBuffet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuentaBuffetLinea" (
    "id" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "precioUnit" DECIMAL(10,2) NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "CuentaBuffetLinea_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CuentaBuffetLinea_cantidad_positiva" CHECK ("cantidad" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "CuentaBuffet_ticketId_key" ON "CuentaBuffet"("ticketId");
CREATE INDEX "CuentaBuffet_mostradorId_estado_idx" ON "CuentaBuffet"("mostradorId", "estado");
CREATE INDEX "CuentaBuffet_canchaId_idx" ON "CuentaBuffet"("canchaId");
CREATE UNIQUE INDEX "CuentaBuffetLinea_cuentaId_productoId_key" ON "CuentaBuffetLinea"("cuentaId", "productoId");

-- Una cancha, una cuenta abierta a la vez (también frena la carrera de dos aperturas simultáneas).
CREATE UNIQUE INDEX "CuentaBuffet_canchaId_abierta_key" ON "CuentaBuffet"("canchaId") WHERE "estado" = 'ABIERTA';

-- AddForeignKey
ALTER TABLE "CuentaBuffet" ADD CONSTRAINT "CuentaBuffet_mostradorId_fkey" FOREIGN KEY ("mostradorId") REFERENCES "Mostrador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CuentaBuffet" ADD CONSTRAINT "CuentaBuffet_canchaId_fkey" FOREIGN KEY ("canchaId") REFERENCES "Cancha"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CuentaBuffet" ADD CONSTRAINT "CuentaBuffet_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "Reserva"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CuentaBuffet" ADD CONSTRAINT "CuentaBuffet_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "CajaBuffet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CuentaBuffet" ADD CONSTRAINT "CuentaBuffet_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "TicketBuffet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CuentaBuffetLinea" ADD CONSTRAINT "CuentaBuffetLinea_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "CuentaBuffet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CuentaBuffetLinea" ADD CONSTRAINT "CuentaBuffetLinea_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "ProductoBuffet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
