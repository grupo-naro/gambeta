import { apiFetch } from '@/lib/api';
import { requireAdmin } from '@/lib/require-admin';
import type { Suscripcion } from '@/lib/types';
import { SociosTable } from '@/components/socios/socios-table';

export default async function SociosPage() {
  await requireAdmin();
  const socios = await apiFetch<Suscripcion[]>('/suscripciones');
  return <SociosTable socios={socios} />;
}
