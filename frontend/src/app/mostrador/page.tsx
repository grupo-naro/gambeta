import { redirect } from 'next/navigation';
import { sesionBuffetValida } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import type { CajaBuffetEstado, ProductoCobro } from '@/lib/types';
import { PantallaVenta } from '@/components/mostrador/pantalla-venta';

export default async function MostradorPage() {
  if (!(await sesionBuffetValida())) redirect('/mostrador/pin');
  const [caja, productos] = await Promise.all([
    buffetFetch<CajaBuffetEstado | null>('/buffet/caja/actual'),
    buffetFetch<ProductoCobro[]>('/buffet/productos/activos'),
  ]);
  return <PantallaVenta inicial={caja} productos={productos} />;
}
