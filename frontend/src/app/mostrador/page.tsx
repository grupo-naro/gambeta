import { redirect } from 'next/navigation';
import { mostradorDeSesion } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import type { CajaBuffetEstado, ProductoCobro, ConciliacionPendiente, StockAsignado } from '@/lib/types';
import { PantallaVenta } from '@/components/mostrador/pantalla-venta';

export default async function MostradorPage() {
  const mostrador = await mostradorDeSesion();
  if (!mostrador) redirect('/mostrador/pin');
  const esPrincipal = mostrador.tipo === 'PRINCIPAL';

  const [caja, productos, pendientes, asignado] = await Promise.all([
    buffetFetch<CajaBuffetEstado | null>('/buffet/caja/actual'),
    buffetFetch<ProductoCobro[]>('/buffet/productos/activos'),
    // Cada puesto pide solo lo que le corresponde: pedir lo del otro da 403.
    esPrincipal ? buffetFetch<ConciliacionPendiente[]>('/buffet/conciliaciones/pendientes') : Promise.resolve([]),
    esPrincipal ? Promise.resolve([] as StockAsignado[]) : buffetFetch<StockAsignado[]>('/buffet/stock-asignado'),
  ]);

  return (
    <PantallaVenta
      inicial={caja}
      productos={productos}
      mostrador={mostrador}
      pendientes={pendientes}
      asignado={asignado}
    />
  );
}
