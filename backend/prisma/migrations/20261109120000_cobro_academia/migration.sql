-- Los cobros de un entrenamiento (la academia) dejan de ser "evento": tienen su propio origen.
-- Los que ya estaban cargados se reconocen por el mes que pagan (bloqueoMes).
--
-- Orden importante: primero se afloja el CHECK, después se actualizan los cobros y al final se
-- vuelve a crear. Hay cobros de academia sin destino (el entrenamiento ya se eliminó) y con el
-- CHECK viejo el UPDATE a ACADEMIA los rechaza (23514).

-- 1. Sacar el CHECK viejo (solo admitía ABONO/EVENTO sin destino).
ALTER TABLE "Cobro" DROP CONSTRAINT cobro_destino_unico;

-- 2. Pasar los cobros de entrenamientos a ACADEMIA.
UPDATE "Cobro" SET "origen" = 'ACADEMIA' WHERE "bloqueoMes" IS NOT NULL;

-- 3. CHECK nuevo: un cobro sin destino (el entrenamiento ya se eliminó) también se admite con origen ACADEMIA.
ALTER TABLE "Cobro" ADD CONSTRAINT cobro_destino_unico
  CHECK (
    (("reservaId" IS NOT NULL)::int + ("suscripcionId" IS NOT NULL)::int
      + ("turnoFijoId" IS NOT NULL)::int + ("bloqueoId" IS NOT NULL)::int) = 1
    OR (
      "reservaId" IS NULL AND "suscripcionId" IS NULL AND "turnoFijoId" IS NULL AND "bloqueoId" IS NULL
      AND "origen" IN ('ABONO', 'EVENTO', 'ACADEMIA')
    )
  );
