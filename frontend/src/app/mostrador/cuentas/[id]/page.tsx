import { redirect } from 'next/navigation';
import { mostradorDeSesion, manejarBuffetNoAutorizado } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import { ApiError } from '@/lib/types';
import type { CuentaBuffet, ProductoCobro } from '@/lib/types';
import { PantallaCuenta } from '@/components/mostrador/pantalla-cuenta';

export default async function CuentaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mostrador = await mostradorDeSesion();
  if (!mostrador) redirect('/mostrador/pin');

  let cuenta: CuentaBuffet;
  let productos: ProductoCobro[];
  try {
    [cuenta, productos] = await Promise.all([
      buffetFetch<CuentaBuffet>(`/buffet/cuentas/${encodeURIComponent(id)}`),
      buffetFetch<ProductoCobro[]>('/buffet/productos/activos'),
    ]);
  } catch (e) {
    await manejarBuffetNoAutorizado(e);
    // Una cuenta que no existe o es de otro mostrador vuelve a la lista en vez de romper la pantalla.
    if (e instanceof ApiError && e.status === 404) redirect('/mostrador/cuentas');
    throw e;
  }
  return <PantallaCuenta inicial={cuenta} productos={productos} />;
}
