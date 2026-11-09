-- Los cobros de un entrenamiento (la academia) dejan de ser "evento": tienen su propio origen.
-- Los que ya estaban cargados se reconocen por el mes que pagan (bloqueoMes).
UPDATE "Cobro" SET "origen" = 'ACADEMIA' WHERE "bloqueoMes" IS NOT NULL;

-- Un cobro sin destino (el entrenamiento ya se eliminó) también se admite con origen ACADEMIA.
ALTER TABLE "Cobro" DROP CONSTRAINT cobro_destino_unico;
ALTER TABLE "Cobro" ADD CONSTRAINT cobro_destino_unico
  CHECK (
    (("reservaId" IS NOT NULL)::int + ("suscripcionId" IS NOT NULL)::int
      + ("turnoFijoId" IS NOT NULL)::int + ("bloqueoId" IS NOT NULL)::int) = 1
    OR (
      "reservaId" IS NULL AND "suscripcionId" IS NULL AND "turnoFijoId" IS NULL AND "bloqueoId" IS NULL
      AND "origen" IN ('ABONO', 'EVENTO', 'ACADEMIA')
    )
  );
