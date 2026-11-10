import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { Bloqueo, Cancha } from '@/lib/types';
import { clasesDeAcademia } from '@/lib/academia';
import { BloqueosTable } from '@/components/bloqueos/bloqueos-table';

export default async function BloqueosPage() {
  await requireAdmin();
  const [bloqueos, canchas] = await Promise.all([
    apiFetch<Bloqueo[]>('/bloqueos'),
    apiFetch<Cancha[]>('/canchas'),
  ]);
  // Las clases de la academia se manejan desde su propio módulo.
  const deAcademia = new Set(clasesDeAcademia(bloqueos).map((b) => b.id));
  return <BloqueosTable bloqueos={bloqueos.filter((b) => !deAcademia.has(b.id))} canchas={canchas} />;
}
