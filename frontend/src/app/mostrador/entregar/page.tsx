import { redirect } from 'next/navigation';
import { mostradorDeSesion, manejarBuffetNoAutorizado } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import type { ProductoCobro, StockAsignado } from '@/lib/types';
import { PantallaEntrega } from '@/components/mostrador/pantalla-entrega';

export default async function EntregarPage() {
  const mostrador = await mostradorDeSesion();
  if (!mostrador) redirect('/mostrador/pin');
  if (mostrador.tipo !== 'PRINCIPAL') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-xl font-semibold">Esto lo hace el mostrador principal.</p>
        <a href="/mostrador" className="rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white">Volver a vender</a>
      </main>
    );
  }

  let productos: ProductoCobro[];
  let asignado: StockAsignado[];
  try {
    [productos, asignado] = await Promise.all([
      buffetFetch<ProductoCobro[]>('/buffet/productos/activos'),
      buffetFetch<StockAsignado[]>('/buffet/stock-asignado?mostradorId=mostrador-secundario'),
    ]);
  } catch (e) {
    await manejarBuffetNoAutorizado(e);
    throw e;
  }
  return <PantallaEntrega productos={productos} asignado={asignado} />;
}
