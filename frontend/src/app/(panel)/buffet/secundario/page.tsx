import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { DiaSecundario } from '@/lib/types';
import { DiarioPuesto } from '@/components/buffet/diario-puesto';

export default async function SecundarioPage() {
  await requireAdmin();
  const dias = await apiFetch<DiaSecundario[]>('/buffet/secundario/diario?dias=14');
  return <DiarioPuesto titulo="Mostrador secundario" activa="secundario" dias={dias} />;
}
