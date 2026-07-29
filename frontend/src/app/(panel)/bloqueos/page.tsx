import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { Bloqueo, Cancha } from '@/lib/types';
import { BloqueosTable } from '@/components/bloqueos/bloqueos-table';

export default async function BloqueosPage() {
  await requireAdmin();
  const [bloqueos, canchas] = await Promise.all([
    apiFetch<Bloqueo[]>('/bloqueos'),
    apiFetch<Cancha[]>('/canchas'),
  ]);
  return <BloqueosTable bloqueos={bloqueos} canchas={canchas} />;
}
