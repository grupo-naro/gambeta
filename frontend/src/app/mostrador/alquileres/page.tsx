import { redirect } from 'next/navigation';
import { mostradorDeSesion, manejarBuffetNoAutorizado } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import type { Alquiler, ArticuloAlquiler } from '@/lib/types';
import { PantallaAlquileres } from '@/components/mostrador/pantalla-alquileres';

export default async function MostradorAlquileresPage() {
  const mostrador = await mostradorDeSesion();
  if (!mostrador) redirect('/mostrador/pin');
  // El backend ya rechaza al secundario con 403; esto evita renderizarle una pantalla que solo
  // sabría mostrar el error.
  if (mostrador.tipo !== 'PRINCIPAL') redirect('/mostrador');

  let articulos: ArticuloAlquiler[]; let afuera: Alquiler[];
  try {
    [articulos, afuera] = await Promise.all([
      buffetFetch<ArticuloAlquiler[]>('/alquileres/botonera'),
      buffetFetch<Alquiler[]>('/alquileres/afuera'),
    ]);
  } catch (e) {
    await manejarBuffetNoAutorizado(e);
    throw e;
  }

  return <PantallaAlquileres articulos={articulos} afuera={afuera} />;
}
