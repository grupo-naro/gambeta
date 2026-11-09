-- El valor de un entrenamiento recurrente es MENSUAL (no por clase): cada cobro se ata al mes que paga.
-- Se guarda el primer dia del mes. Si quedaron cobros atados a una fecha, se llevan al primer dia de su mes.
ALTER TABLE "Cobro" RENAME COLUMN "bloqueoFecha" TO "bloqueoMes";
UPDATE "Cobro" SET "bloqueoMes" = date_trunc('month', "bloqueoMes")::date WHERE "bloqueoMes" IS NOT NULL;
