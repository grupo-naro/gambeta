import { redirect } from 'next/navigation';
import { mostradorDeSesion, manejarBuffetNoAutorizado } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import type { ProductoCobro, StockAsignado } from '@/lib/types';
import { PantallaEntrega, type PuestoEntrega } from '@/components/mostrador/pantalla-entrega';

/** Los puestos a los que el principal le entrega mercadería. */
const PUESTOS = [
  { id: 'mostrador-secundario', nombre: 'Secundario' },
  { id: 'mostrador-tercero', nombre: 'Tercero' },
];

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
  let puestos: PuestoEntrega[];
  try {
    let asignados: StockAsignado[][];
    [productos, ...asignados] = await Promise.all([
      buffetFetch<ProductoCobro[]>('/buffet/productos/activos'),
      ...PUESTOS.map((p) => buffetFetch<StockAsignado[]>(`/buffet/stock-asignado?mostradorId=${p.id}`)),
    ]) as [ProductoCobro[], ...StockAsignado[][]];
    puestos = PUESTOS.map((p, i) => ({ ...p, asignado: asignados[i] }));
  } catch (e) {
    await manejarBuffetNoAutorizado(e);
    throw e;
  }
  return <PantallaEntrega productos={productos} puestos={puestos} />;
}
