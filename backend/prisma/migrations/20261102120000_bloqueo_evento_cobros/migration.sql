-- Bloqueos de evento con plata (cumpleaños, etc.): valor total opcional y cobros (seña + saldo).
ALTER TABLE "Bloqueo" ADD COLUMN "valor" DECIMAL(10,2);

ALTER TABLE "Cobro" ADD COLUMN "bloqueoId" TEXT;
CREATE INDEX "Cobro_bloqueoId_idx" ON "Cobro"("bloqueoId");
-- SET NULL: eliminar el bloqueo conserva el cobro en la caja (queda con origen = 'EVENTO').
ALTER TABLE "Cobro" ADD CONSTRAINT "Cobro_bloqueoId_fkey"
  FOREIGN KEY ("bloqueoId") REFERENCES "Bloqueo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Un cobro pertenece a exactamente un destino; los huérfanos solo se admiten para abono o evento
-- (el fijo o el bloqueo ya se eliminaron).
ALTER TABLE "Cobro" DROP CONSTRAINT cobro_destino_unico;
ALTER TABLE "Cobro" ADD CONSTRAINT cobro_destino_unico
  CHECK (
    (("reservaId" IS NOT NULL)::int + ("suscripcionId" IS NOT NULL)::int
      + ("turnoFijoId" IS NOT NULL)::int + ("bloqueoId" IS NOT NULL)::int) = 1
    OR (
      "reservaId" IS NULL AND "suscripcionId" IS NULL AND "turnoFijoId" IS NULL AND "bloqueoId" IS NULL
      AND "origen" IN ('ABONO', 'EVENTO')
    )
  );
