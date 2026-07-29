-- AlterTable
ALTER TABLE "Cancha" ADD COLUMN     "esEntera" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "grupoId" TEXT;

-- CreateTable
CREATE TABLE "CanchaGrupo" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanchaGrupo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sector" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanchaSector" (
    "canchaId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,

    CONSTRAINT "CanchaSector_pkey" PRIMARY KEY ("canchaId","sectorId")
);

-- CreateTable
CREATE TABLE "ReservaSector" (
    "id" TEXT NOT NULL,
    "reservaId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    "estado" "EstadoReserva" NOT NULL,
    "fechaInicio" TIMESTAMPTZ(3) NOT NULL,
    "fechaFin" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReservaSector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReservaSector_sectorId_idx" ON "ReservaSector"("sectorId");

-- AddForeignKey
ALTER TABLE "CanchaSector" ADD CONSTRAINT "CanchaSector_canchaId_fkey" FOREIGN KEY ("canchaId") REFERENCES "Cancha"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanchaSector" ADD CONSTRAINT "CanchaSector_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservaSector" ADD CONSTRAINT "ReservaSector_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "Reserva"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservaSector" ADD CONSTRAINT "ReservaSector_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cancha" ADD CONSTRAINT "Cancha_grupoId_fkey" FOREIGN KEY ("grupoId") REFERENCES "CanchaGrupo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
