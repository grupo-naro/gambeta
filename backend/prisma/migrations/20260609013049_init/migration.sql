-- CreateEnum
CREATE TYPE "EstadoReserva" AS ENUM ('CONFIRMADA', 'ESPERANDO_SENA', 'CANCELADA', 'COMPLETADA');

-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "VerificadoPor" AS ENUM ('IA', 'HUMANO');

-- CreateTable
CREATE TABLE "Cancha" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "precioHora" DECIMAL(10,2) NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cancha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HorarioDisponible" (
    "id" TEXT NOT NULL,
    "canchaId" TEXT NOT NULL,
    "diaSemana" INTEGER NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "HorarioDisponible_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "esContacto" BOOLEAN NOT NULL DEFAULT false,
    "primeraReserva" TIMESTAMP(3),
    "totalReservas" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reserva" (
    "id" TEXT NOT NULL,
    "canchaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "fechaInicio" TIMESTAMPTZ(3) NOT NULL,
    "fechaFin" TIMESTAMPTZ(3) NOT NULL,
    "estado" "EstadoReserva" NOT NULL,
    "esContacto" BOOLEAN NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "montoSena" DECIMAL(10,2),
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pago" (
    "id" TEXT NOT NULL,
    "reservaId" TEXT NOT NULL,
    "montoDetectado" DECIMAL(10,2),
    "comprobanteUrl" TEXT,
    "verificadoPor" "VerificadoPor",
    "aprobadoPorId" TEXT,
    "estado" "EstadoPago" NOT NULL DEFAULT 'PENDIENTE',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT,
    "payload" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cancha_activa_idx" ON "Cancha"("activa");

-- CreateIndex
CREATE INDEX "HorarioDisponible_canchaId_diaSemana_idx" ON "HorarioDisponible"("canchaId", "diaSemana");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_whatsapp_key" ON "Cliente"("whatsapp");

-- CreateIndex
CREATE INDEX "Reserva_canchaId_fechaInicio_idx" ON "Reserva"("canchaId", "fechaInicio");

-- CreateIndex
CREATE INDEX "Reserva_clienteId_idx" ON "Reserva"("clienteId");

-- CreateIndex
CREATE INDEX "Reserva_estado_idx" ON "Reserva"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "Pago_reservaId_key" ON "Pago"("reservaId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AuditLog_entidad_entidadId_idx" ON "AuditLog"("entidad", "entidadId");

-- CreateIndex
CREATE INDEX "AuditLog_creadoEn_idx" ON "AuditLog"("creadoEn");

-- AddForeignKey
ALTER TABLE "HorarioDisponible" ADD CONSTRAINT "HorarioDisponible_canchaId_fkey" FOREIGN KEY ("canchaId") REFERENCES "Cancha"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_canchaId_fkey" FOREIGN KEY ("canchaId") REFERENCES "Cancha"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reserva" ADD CONSTRAINT "Reserva_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "Reserva"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_aprobadoPorId_fkey" FOREIGN KEY ("aprobadoPorId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
