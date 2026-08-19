'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Alquiler, ArticuloAlquiler, EstadoCierreAlquiler, MedioPago } from '@/lib/types';
import { entregarAlquiler, cerrarAlquiler } from '@/lib/alquiler-actions';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/** Total del alquiler. Un NaN de un input vacío vale 0, no rompe la pantalla. */
export function calcularTotalAlquiler(precio: number, cantidad: number): number {
  const total = Number(precio) * Number(cantidad);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

/** Si se puede entregar esa cantidad: al menos una, y nunca más de lo que hay. */
export function puedeEntregar(a: { disponible: number }, cantidad: number): boolean {
  return Number.isFinite(cantidad) && cantidad >= 1 && cantidad <= a.disponible;
}

/**
 * El uid de un intento de entrega: reusa el que ya está en curso, y solo acuña uno nuevo cuando
 * no hay ninguno vivo. Si un intento falla no queda alquiler en la base, así que se puede
 * corregir y reenviar; y si lo que se perdió fue la respuesta de un intento que SÍ entró, el
 * reenvío con el mismo uid devuelve el mismo alquiler en vez de prestar dos veces.
 */
export function uidDeIntento(actual: string | null): string {
  return actual ?? crypto.randomUUID();
}

export function PantallaAlquileres({
  articulos, afuera,
}: { articulos: ArticuloAlquiler[]; afuera: Alquiler[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<ArticuloAlquiler | null>(null);
  const [cantidad, setCantidad] = useState('1');
  const [quienRetira, setQuienRetira] = useState('');
  const [garantia, setGarantia] = useState('');
  const [medioPago, setMedioPago] = useState<MedioPago>('EFECTIVO');
  const [montoPagado, setMontoPagado] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uidEntrega = useRef<string | null>(null);

  const total = sel ? calcularTotalAlquiler(sel.precio, Number(cantidad)) : 0;

  function limpiar() {
    setSel(null); setCantidad('1'); setQuienRetira(''); setGarantia(''); setMontoPagado(''); setMedioPago('EFECTIVO');
  }

  async function confirmar() {
    if (!sel) return;
    if (!puedeEntregar(sel, Number(cantidad))) { setError(`Solo quedan ${sel.disponible}`); return; }
    if (!quienRetira.trim()) { setError('Poné a nombre de quién sale'); return; }
    setOcupado(true); setError(null);
    uidEntrega.current = uidDeIntento(uidEntrega.current);
    const r = await entregarAlquiler({
      uid: uidEntrega.current, articuloId: sel.id, cantidad: Number(cantidad),
      quienRetira: quienRetira.trim(), garantia: garantia.trim() || null,
      medioPago, montoPagado: medioPago === 'EFECTIVO' ? Number(montoPagado) || 0 : 0,
    });
    setOcupado(false);
    if (!r.ok) { setError(r.error); return; }
    uidEntrega.current = null;
    limpiar();
    router.refresh();
  }

  async function cerrar(a: Alquiler, estado: EstadoCierreAlquiler) {
    setOcupado(true); setError(null);
    const r = await cerrarAlquiler(a.id, estado);
    setOcupado(false);
    if (!r.ok) { setError(r.error); return; }
    router.refresh();
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Alquileres</h1>
        <a href="/mostrador" className="rounded-lg border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-700">
          Volver al mostrador
        </a>
      </div>

      {error && <p className="rounded-xl bg-red-50 p-3 text-red-700 ring-1 ring-inset ring-red-600/20">{error}</p>}

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase text-neutral-500">Entregar</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {articulos.map((a) => (
            <button
              key={a.id} type="button" disabled={a.disponible < 1}
              onClick={() => { setSel(a); setCantidad('1'); }}
              className={`rounded-2xl p-4 text-left ${
                sel?.id === a.id ? 'bg-emerald-600 text-white' : 'border bg-white'
              } ${a.disponible < 1 ? 'opacity-40' : ''}`}
            >
              <span className="block font-semibold">{a.nombre}</span>
              <span className="block text-sm">{money(a.precio)}</span>
              <span className="block text-xs">quedan {a.disponible}</span>
            </button>
          ))}
        </div>

        {sel && (
          <div className="space-y-3 rounded-2xl border bg-white p-4">
            <div className="flex flex-wrap gap-3">
              <label className="text-sm">Cantidad
                <input type="number" min="1" max={sel.disponible} value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  className="ml-2 w-20 rounded-lg border px-2 py-1" />
              </label>
              <label className="text-sm flex-1">Quién retira
                <input value={quienRetira} onChange={(e) => setQuienRetira(e.target.value)}
                  className="ml-2 w-full max-w-xs rounded-lg border px-2 py-1" placeholder="Nombre" />
              </label>
              <label className="text-sm flex-1">Garantía
                <input value={garantia} onChange={(e) => setGarantia(e.target.value)}
                  className="ml-2 w-full max-w-xs rounded-lg border px-2 py-1" placeholder="DNI, llaves…" />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(['EFECTIVO', 'TRANSFERENCIA'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMedioPago(m)}
                  className={`rounded-xl px-4 py-2 font-semibold ${medioPago === m ? 'bg-neutral-900 text-white' : 'border'}`}>
                  {m === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}
                </button>
              ))}
              {medioPago === 'EFECTIVO' && (
                <input type="number" value={montoPagado} onChange={(e) => setMontoPagado(e.target.value)}
                  placeholder="Con cuánto paga" className="w-40 rounded-lg border px-2 py-1" />
              )}
              <span className="ml-auto text-lg font-semibold tabular-nums">{money(total)}</span>
            </div>

            <button type="button" disabled={ocupado} onClick={() => void confirmar()}
              className="h-14 w-full rounded-2xl bg-emerald-600 text-xl font-semibold text-white active:scale-95">
              Entregar y cobrar
            </button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase text-neutral-500">Afuera ({afuera.length})</h2>
        {afuera.length === 0 ? (
          <p className="rounded-xl border bg-white p-4 text-sm text-neutral-600">No hay nada prestado.</p>
        ) : afuera.map((a) => (
          <article key={a.id} className="rounded-xl border bg-white p-3">
            <p className="font-medium">
              {a.articuloNombre} ×{a.cantidad} · {a.quienRetira}
              {a.garantia && <span className="ml-2 text-sm text-neutral-600">garantía: {a.garantia}</span>}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={ocupado} onClick={() => void cerrar(a, 'DEVUELTO')}
                className="rounded-lg bg-emerald-600 px-3 py-1 font-semibold text-white">Devuelto</button>
              <button type="button" disabled={ocupado} onClick={() => void cerrar(a, 'ROTO')}
                className="rounded-lg border border-amber-600 px-3 py-1 font-semibold text-amber-700">Roto</button>
              <button type="button" disabled={ocupado} onClick={() => void cerrar(a, 'PERDIDO')}
                className="rounded-lg border border-red-600 px-3 py-1 font-semibold text-red-700">Perdido</button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
