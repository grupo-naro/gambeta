-- CreateEnum
CREATE TYPE "MotivoBloqueo" AS ENUM ('TORNEO', 'ENTRENAMIENTO', 'MANTENIMIENTO', 'OTRO');

-- CreateTable
CREATE TABLE "TurnoFijo" (
    "id" TEXT NOT NULL,
    "canchaId" TEXT NOT NULL,
    "clienteNombre" TEXT NOT NULL,
    "whatsapp" TEXT,
    "diaSemana" INTEGER NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TurnoFijo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurnoFijoExcepcion" (
    "id" TEXT NOT NULL,
    "turnoFijoId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,

    CONSTRAINT "TurnoFijoExcepcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bloqueo" (
    "id" TEXT NOT NULL,
    "canchaId" TEXT NOT NULL,
    "motivo" "MotivoBloqueo" NOT NULL,
    "recurrente" BOOLEAN NOT NULL DEFAULT false,
    "diaSemana" INTEGER,
    "fecha" DATE,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    "nota" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bloqueo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TurnoFijo_canchaId_diaSemana_idx" ON "TurnoFijo"("canchaId", "diaSemana");

-- CreateIndex
CREATE UNIQUE INDEX "TurnoFijoExcepcion_turnoFijoId_fecha_key" ON "TurnoFijoExcepcion"("turnoFijoId", "fecha");

-- CreateIndex
CREATE INDEX "Bloqueo_canchaId_idx" ON "Bloqueo"("canchaId");

-- AddForeignKey
ALTER TABLE "TurnoFijo" ADD CONSTRAINT "TurnoFijo_canchaId_fkey" FOREIGN KEY ("canchaId") REFERENCES "Cancha"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurnoFijoExcepcion" ADD CONSTRAINT "TurnoFijoExcepcion_turnoFijoId_fkey" FOREIGN KEY ("turnoFijoId") REFERENCES "TurnoFijo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bloqueo" ADD CONSTRAINT "Bloqueo_canchaId_fkey" FOREIGN KEY ("canchaId") REFERENCES "Cancha"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
