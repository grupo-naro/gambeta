'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { entregarStock } from '@/lib/buffet-actions';
import { asignadoPorProducto } from '@/lib/mostrador-stock';
import type { ProductoCobro, StockAsignado } from '@/lib/types';

export function PantallaEntrega({ productos, asignado }: { productos: ProductoCobro[]; asignado: StockAsignado[] }) {
  const router = useRouter();
  const yaTiene = asignadoPorProducto(asignado);
  const [cant, setCant] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  // router.refresh() es asíncrono: entre que limpiamos el form y que llegan los números nuevos
  // del server (el "ya tiene" actualizado), useTransition nos dice cuándo terminó de verdad.
  const [refrescando, startRefresh] = useTransition();
  const [confirmacion, setConfirmacion] = useState<{ productoId: string; nombre: string; cantidad: number }[] | null>(null);

  const items = Object.entries(cant)
    .map(([productoId, cantidad]) => ({ productoId, cantidad }))
    .filter((i) => i.cantidad > 0);

  function setear(id: string, valor: string, tope: number) {
    const n = Math.max(0, Math.min(tope, Number(valor.replace(/\D/g, '')) || 0));
    setCant((c) => ({ ...c, [id]: n }));
  }

  function entregar() {
    if (items.length === 0) { setError('Cargá al menos un producto'); return; }
    setError(''); setEnviando(true); setConfirmacion(null);
    void entregarStock(items).then((r) => {
      setEnviando(false);
      if (r.ok) {
        // La confirmación explícita queda en pantalla mientras dura el refresh: sin esto el
        // form queda en blanco y el "ya tiene" sigue viejo, el operador duda si se aplicó, y
        // como el POST no tiene clave de idempotencia, entregar "por las dudas" mueve stock de
        // verdad una segunda vez.
        setConfirmacion(items.map((i) => ({
          productoId: i.productoId,
          nombre: productos.find((p) => p.id === i.productoId)?.nombre ?? i.productoId,
          cantidad: i.cantidad,
        })));
        setCant({});
        startRefresh(() => { router.refresh(); });
      }
      // La entrega es todo o nada: el servicio la hace en una transacción. Si falla, no se
      // movió nada, y decirlo evita que el operador entregue dos veces por las dudas.
      else setError(`${r.error} — no se entregó nada.`);
    });
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Entregar al secundario</h1>
        <a href="/mostrador" className="rounded-lg border px-3 py-1 text-sm font-medium">Volver</a>
      </header>

      <p aria-live="polite" className={error ? 'text-lg font-semibold text-red-600' : 'sr-only'}>{error}</p>

      {confirmacion && (
        <div aria-live="polite" className="rounded-2xl border border-emerald-600 bg-emerald-50 p-3">
          <p className="font-semibold text-emerald-800">
            {refrescando ? 'Entregado, actualizando la pantalla…' : 'Entregado.'}
          </p>
          <ul className="mt-1 text-sm text-emerald-800">
            {confirmacion.map((c) => (
              <li key={c.productoId}>{c.nombre} × {c.cantidad}</li>
            ))}
          </ul>
        </div>
      )}

      <ul className="divide-y rounded-2xl border bg-white">
        {productos.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="font-semibold">{p.nombre}</p>
              <p className="text-sm text-neutral-600">
                Hay {p.stock} · ya tiene {yaTiene[p.id] ?? 0}
              </p>
            </div>
            <input
              inputMode="numeric"
              aria-label={`Cantidad de ${p.nombre}`}
              value={cant[p.id] ?? ''}
              onChange={(e) => setear(p.id, e.target.value, p.stock)}
              placeholder="0"
              className="w-20 rounded-xl border p-2 text-center text-lg"
            />
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={entregar}
        disabled={enviando || items.length === 0}
        className="rounded-2xl bg-emerald-600 py-4 text-lg font-bold text-white disabled:opacity-50"
      >
        {enviando ? 'Entregando…' : `Entregar ${items.length} producto(s)`}
      </button>
    </main>
  );
}
