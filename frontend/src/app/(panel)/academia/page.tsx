import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import { hoyAR } from '@/lib/fecha';
import { clasesDeAcademia } from '@/lib/academia';
import type { MesesBloqueo } from '@/lib/meses-bloqueo';
import type { Bloqueo, Cancha } from '@/lib/types';
import { AcademiaLista } from '@/components/academia/academia-lista';

export default async function AcademiaPage() {
  await requireAdmin();
  const [bloqueos, canchas] = await Promise.all([
    apiFetch<Bloqueo[]>('/bloqueos'),
    apiFetch<Cancha[]>('/canchas'),
  ]);
  const clases = clasesDeAcademia(bloqueos);
  // Los meses de cada clase con valor (lo cobrado y lo que se debe), para ver quién está al día.
  const mesesPorClase: Record<string, MesesBloqueo['meses']> = {};
  await Promise.all(clases.filter((c) => c.valor != null).map(async (c) => {
    try { mesesPorClase[c.id] = (await apiFetch<MesesBloqueo>(`/bloqueos/${c.id}/meses`)).meses; } catch { /* sin estado: se muestra como fuera de período */ }
  }));
  return <AcademiaLista clases={clases} canchas={canchas} mesesPorClase={mesesPorClase} mesActual={hoyAR().slice(0, 7)} />;
}
