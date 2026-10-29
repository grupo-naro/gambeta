'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CuentaBuffet, CanchaMostrador } from '@/lib/types';
import { abrirCuenta } from '@/lib/buffet-actions';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/**
 * Cuentas abiertas del mostrador (una por cancha) y el acceso para abrir una nueva. Tocar una cuenta
 * la abre para sumar consumos o rendirla.
 */
export function PantallaCuentas({ canchas, abiertas }: { canchas: CanchaMostrador[]; abiertas: CuentaBuffet[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  const conCuenta = new Set(abiertas.map((c) => c.canchaId));
  const libres = canchas.filter((c) => !conCuenta.has(c.id));

  async function abrir(canchaId: string) {
    if (ocupado) return;
    setOcupado(true);
    setError('');
    const r = await abrirCuenta(canchaId);
    if (!r.ok) { setOcupado(false); setError(r.error); return; }
    router.push(`/mostrador/cuentas/${r.data.id}`);
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <a href="/mostrador" className="rounded-xl border border-neutral-300 px-4 py-2 font-semibold text-neutral-700">← Volver a la venta</a>
        <h1 className="text-2xl font-bold">Cuentas por cancha</h1>
      </div>

      <div aria-live="polite" className="min-h-6 text-center text-lg font-semibold text-red-600">{error}</div>

      <section>
        <p className="mb-2 text-lg font-semibold">Abiertas ({abiertas.length})</p>
        {abiertas.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-neutral-300 p-6 text-center text-neutral-500">No hay cuentas abiertas.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {abiertas.map((c) => (
              <li key={c.id}>
                <a href={`/mostrador/cuentas/${c.id}`} className="block rounded-2xl border-2 border-emerald-600 bg-emerald-50 p-4 active:scale-[0.99]">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-xl font-bold">{c.canchaNombre}</span>
                    <span className="text-xl font-bold tabular-nums text-emerald-800">{money(c.total)}</span>
                  </span>
                  <span className="mt-1 block text-sm text-neutral-600">
                    {c.reserva ? `${c.reserva.clienteNombre} · ${c.reserva.horaInicio}–${c.reserva.horaFin}` : 'Sin reserva en curso'}
                    {' · '}{c.lineas.reduce((a, l) => a + l.cantidad, 0)} consumos
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <p className="mb-2 text-lg font-semibold">Abrir una cuenta</p>
        {libres.length === 0 ? (
          <p className="text-neutral-500">Todas las canchas ya tienen una cuenta abierta.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {libres.map((c) => (
              <button key={c.id} type="button" disabled={ocupado} onClick={() => void abrir(c.id)}
                className="h-20 rounded-2xl border-2 border-neutral-300 bg-white text-xl font-semibold active:scale-95 disabled:opacity-50">
                {c.nombre}
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
