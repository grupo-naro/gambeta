import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { Cancha } from '@/lib/types';
import { CanchasTable } from '@/components/canchas/canchas-table';

export default async function CanchasPage() {
  await requireAdmin();
  const canchas = await apiFetch<Cancha[]>('/canchas');
  return <CanchasTable canchas={canchas} />;
}
