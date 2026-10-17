/**
 * Período de un turno fijo ("Desde / Hasta" del abono). Helpers puros, sin base de datos.
 *
 * Un fijo solo existe dentro de su período: pasado el "hasta" deja de ocupar el horario y de
 * aparecer; si el cliente renueva, se da de alta un fijo nuevo. Ambos extremos son INCLUSIVOS y
 * opcionales (sin "desde" empieza en el pasado infinito, sin "hasta" no termina nunca).
 *
 * Las fechas de negocio son 'YYYY-MM-DD'; en la DB son `@db.Date`, que Prisma devuelve como
 * Date a medianoche UTC.
 */

type Periodo = { vigenciaDesde?: Date | null; vigenciaHasta?: Date | null };

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** ¿El fijo ocupa esa fecha ('YYYY-MM-DD')? */
export function fijoVigenteEn(f: Periodo, fecha: string): boolean {
  if (f.vigenciaDesde && fecha < ymd(f.vigenciaDesde)) return false;
  if (f.vigenciaHasta && fecha > ymd(f.vigenciaHasta)) return false;
  return true;
}

/** ¿Dos períodos comparten al menos un día? `null` = abierto en ese extremo. */
export function periodosSeSolapan(
  a: { desde: string | null; hasta: string | null },
  b: { desde: string | null; hasta: string | null },
): boolean {
  const empiezaAntesDeQueTermineB = a.desde == null || b.hasta == null || a.desde <= b.hasta;
  const empiezaBAntesDeQueTermineA = b.desde == null || a.hasta == null || b.desde <= a.hasta;
  return empiezaAntesDeQueTermineB && empiezaBAntesDeQueTermineA;
}
