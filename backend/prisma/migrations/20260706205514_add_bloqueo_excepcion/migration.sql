-- CreateTable
CREATE TABLE "BloqueoExcepcion" (
    "id" TEXT NOT NULL,
    "bloqueoId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,

    CONSTRAINT "BloqueoExcepcion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BloqueoExcepcion_bloqueoId_fecha_key" ON "BloqueoExcepcion"("bloqueoId", "fecha");

-- AddForeignKey
ALTER TABLE "BloqueoExcepcion" ADD CONSTRAINT "BloqueoExcepcion_bloqueoId_fkey" FOREIGN KEY ("bloqueoId") REFERENCES "Bloqueo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
