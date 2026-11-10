import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { DiaSecundario } from '@/lib/types';
import { DiarioPuesto } from '@/components/buffet/diario-puesto';

export default async function TerceroPage() {
  await requireAdmin();
  const dias = await apiFetch<DiaSecundario[]>('/buffet/secundario/diario?dias=14&mostradorId=mostrador-tercero');
  return <DiarioPuesto titulo="Mostrador tercero" activa="tercero" dias={dias} />;
}
