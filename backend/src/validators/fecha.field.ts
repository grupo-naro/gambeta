import { z } from 'zod';

// El regex solo valida el formato: "2026-02-31" lo pasa y Date la corre al 3 de marzo. Se
// reconstruye la fecha en UTC y se compara contra los mismos componentes para confirmar que
// existe de verdad (rechaza 31 de febrero, 30 de febrero, etc).
const fechaReal = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/** Fecha de calendario 'YYYY-MM-DD' que además existe de verdad. */
export const fechaYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(fechaReal, { message: 'La fecha no existe' });
