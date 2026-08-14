import { redirect } from 'next/navigation';
import { mostradorDeSesion, manejarBuffetNoAutorizado } from '@/lib/buffet-session';
import { buffetFetch } from '@/lib/buffet-api';
import { ApiError } from '@/lib/types';
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

  let lineas: LineaConciliacion[];
  try {
    lineas = await buffetFetch<LineaConciliacion[]>(`/buffet/cajas/${encodeURIComponent(cajaId)}/conciliacion`);
  } catch (e) {
    // Un mostrador desactivado (401) manda al PIN, no al error.tsx genérico.
    await manejarBuffetNoAutorizado(e);
    // El backend rechaza con 409 una caja que ya tiene conteos (mismo guard y mismo mensaje que
    // usa `conciliar`). Mostramos ese mensaje tal cual en vez de dejar que el error caiga en el
    // error.tsx genérico: el operador tiene que ver POR QUÉ no puede contar esta caja, no un
    // "no se pudo cargar" sin motivo. Cualquier otro error sigue subiendo al boundary.
    if (e instanceof ApiError && e.status === 409) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-xl font-semibold">{e.message}</p>
          <a href="/mostrador" className="rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white">Volver a vender</a>
        </main>
      );
    }
    throw e;
  }

  return <PantallaConteo cajaId={cajaId} lineas={lineas} />;
}
