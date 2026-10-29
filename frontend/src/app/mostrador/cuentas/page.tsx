import { redirect } from 'next/navigation';
import { mostradorDeSesion, manejarBuffetNoAutorizado } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import type { CuentaBuffet, CanchaMostrador } from '@/lib/types';
import { PantallaCuentas } from '@/components/mostrador/pantalla-cuentas';

export default async function CuentasPage() {
  const mostrador = await mostradorDeSesion();
  if (!mostrador) redirect('/mostrador/pin');

  let canchas: CanchaMostrador[];
  let abiertas: CuentaBuffet[];
  try {
    [canchas, abiertas] = await Promise.all([
      buffetFetch<CanchaMostrador[]>('/buffet/canchas'),
      buffetFetch<CuentaBuffet[]>('/buffet/cuentas'),
    ]);
  } catch (e) {
    // Un mostrador desactivado (401) manda al PIN, no al error.tsx genérico.
    await manejarBuffetNoAutorizado(e);
    throw e;
  }
  return <PantallaCuentas canchas={canchas} abiertas={abiertas} />;
}
