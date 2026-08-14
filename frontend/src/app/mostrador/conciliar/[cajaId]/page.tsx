import { redirect } from 'next/navigation';
import { mostradorDeSesion } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import type { LineaConciliacion } from '@/lib/types';
import { PantallaConteo } from '@/components/mostrador/pantalla-conteo';

export default async function ConciliarPage({ params }: { params: Promise<{ cajaId: string }> }) {
  const { cajaId } = await params;
  const mostrador = await mostradorDeSesion();
  if (!mostrador) redirect('/mostrador/pin');
  if (mostrador.tipo !== 'PRINCIPAL') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-xl font-semibold">El conteo lo carga el mostrador principal.</p>
        <a href="/mostrador" className="rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white">Volver a vender</a>
      </main>
    );
  }

  const lineas = await buffetFetch<LineaConciliacion[]>(`/buffet/cajas/${encodeURIComponent(cajaId)}/conciliacion`);

  // El backend no tiene guard de "caja ya conciliada" en esta lectura: sobre una caja que ya
  // se concilió, calcularResumen filtra las entregas por conciliadaEnCajaId null, así que
  // entregado vuelve 0 y esperado = 0 - vendido, negativo. Es la única señal que tenemos acá
  // para no mostrarle al operador cifras inventadas (el 409 real recién aparece al confirmar).
  if (lineas.some((l) => l.esperado < 0)) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-xl font-semibold">Esta caja ya fue conciliada.</p>
        <a href="/mostrador" className="rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white">Volver a vender</a>
      </main>
    );
  }

  return <PantallaConteo cajaId={cajaId} lineas={lineas} />;
}
