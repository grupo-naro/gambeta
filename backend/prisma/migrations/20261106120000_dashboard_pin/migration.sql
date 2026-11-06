-- PIN opcional para ver los números del dashboard (hash bcrypt). Vacío = sin PIN, dashboard abierto.
ALTER TABLE "Configuracion" ADD COLUMN "dashboardPinHash" TEXT NOT NULL DEFAULT '';
