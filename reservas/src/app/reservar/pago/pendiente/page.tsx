'use client';
import { Suspense, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { crearPreferenciaPago } from '@/lib/actions';

export default function PagoPendientePage() {
  return (
    <Suspense fallback={null}>
      <PagoPendienteContenido />
    </Suspense>
  );
}

function PagoPendienteContenido() {
  const params = useSearchParams();
  const reservaId = params.get('external_reference');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  function reintentar() {
    if (!reservaId) return;
    setError('');
    start(async () => {
      const r = await crearPreferenciaPago(reservaId);
      if (!r.ok) { setError(r.error); return; }
      window.location.href = r.data.checkoutUrl;
    });
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-950 p-6 text-center text-neutral-100">
      <div className="text-6xl">⚠️</div>
      <h1 className="text-2xl font-bold">No se completó el pago</h1>
      <p className="text-neutral-400">Tu horario queda reservado por 30 minutos. Si no completás el pago en ese lapso se libera, así que te conviene reintentarlo ahora o contactarnos directamente.</p>
      {error && <p className="text-red-400">{error}</p>}
      {reservaId && (
        <button type="button" disabled={pending} onClick={reintentar}
          className="rounded-xl bg-lime-500 px-6 py-3 font-bold text-black disabled:opacity-50">
          {pending ? 'Generando link…' : 'Reintentar pago'}
        </button>
      )}
    </main>
  );
}
