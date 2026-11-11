import { redirect } from 'next/navigation';
import { mostradorDeSesion, manejarBuffetNoAutorizado } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import { ApiError, tieneCupo } from '@/lib/types';
import type { CuentaBuffet, ProductoCobro, StockAsignado } from '@/lib/types';
import { productosDelMostrador } from '@/lib/mostrador-stock';
import { PantallaCuenta } from '@/components/mostrador/pantalla-cuenta';

export default async function CuentaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mostrador = await mostradorDeSesion();
  if (!mostrador) redirect('/mostrador/pin');

  let cuenta: CuentaBuffet;
  let productos: ProductoCobro[];
  let asignado: StockAsignado[];
  try {
    [cuenta, productos, asignado] = await Promise.all([
      buffetFetch<CuentaBuffet>(`/buffet/cuentas/${encodeURIComponent(id)}`),
      buffetFetch<ProductoCobro[]>('/buffet/productos/activos'),
      // Solo el secundario trabaja con un cupo; el principal y el tercero (catálogo propio) no lo necesitan.
      tieneCupo(mostrador.tipo) ? buffetFetch<StockAsignado[]>('/buffet/stock-asignado') : Promise.resolve([] as StockAsignado[]),
    ]);
  } catch (e) {
    await manejarBuffetNoAutorizado(e);
    // Una cuenta que no existe o es de otro mostrador vuelve a la lista en vez de romper la pantalla.
    if (e instanceof ApiError && e.status === 404) redirect('/mostrador/cuentas');
    throw e;
  }
  // Los productos ya cargados en la cuenta se siguen mostrando aunque el cupo haya llegado a 0.
  const enLaCuenta = cuenta.lineas.map((l) => l.productoId);
  return <PantallaCuenta inicial={cuenta} productos={productosDelMostrador(productos, mostrador.tipo, asignado, enLaCuenta)} />;
}
