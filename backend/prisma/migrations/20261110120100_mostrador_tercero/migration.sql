-- El tercer mostrador nace sin PIN: el admin se lo pone desde el panel y recién ahí entra.
INSERT INTO "Mostrador" ("id", "nombre", "tipo", "pinHash")
VALUES ('mostrador-tercero', 'Tercero', 'TERCERO', '')
ON CONFLICT ("id") DO NOTHING;
