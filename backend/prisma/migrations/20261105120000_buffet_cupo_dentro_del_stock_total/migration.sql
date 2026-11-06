-- Modelo nuevo del buffet: el stock general es el TOTAL del complejo y baja solo al vender.
-- Lo asignado al secundario pasa a ser un cupo DENTRO de ese total (entregar ya no descuenta).
--
-- Hasta ahora entregar restaba del general, así que lo que hoy está asignado al secundario no
-- figura en el general. Se suma de vuelta para que el total siga siendo el real: sin esto, el
-- stock libre (total - asignado) quedaría descontado dos veces.
UPDATE "ProductoBuffet" p
SET "stock" = p."stock" + s.total
FROM (
  SELECT "productoId", SUM("cantidad")::int AS total
  FROM "StockMostrador"
  WHERE "cantidad" > 0
  GROUP BY "productoId"
) s
WHERE p."id" = s."productoId";
