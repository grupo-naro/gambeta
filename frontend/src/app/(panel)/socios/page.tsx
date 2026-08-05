import { notFound } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { requireAdmin } from '@/lib/require-admin';
import type { Suscripcion } from '@/lib/types';
import { SociosTable } from '@/components/socios/socios-table';
import { SOCIOS_HABILITADO } from '@/lib/features';

export default async function SociosPage() {
  await requireAdmin();
  // La sección está apagada: el complejo maneja a los socios con turnos fijos. El menú ya no la
  // muestra, pero la ruta seguía siendo alcanzable escribiendo la URL, y desde ahí se podían
  // cargar suscripciones que el backend ya no aplica. Ver lib/features.ts.
  if (!SOCIOS_HABILITADO) notFound();
  const socios = await apiFetch<Suscripcion[]>('/suscripciones');
  return <SociosTable socios={socios} />;
}
