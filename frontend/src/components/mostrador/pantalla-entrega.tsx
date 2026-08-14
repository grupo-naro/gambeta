'use client';
import { useState } from 'react';
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

  const items = Object.entries(cant)
    .map(([productoId, cantidad]) => ({ productoId, cantidad }))
    .filter((i) => i.cantidad > 0);

  function setear(id: string, valor: string, tope: number) {
    const n = Math.max(0, Math.min(tope, Number(valor.replace(/\D/g, '')) || 0));
    setCant((c) => ({ ...c, [id]: n }));
  }

  function entregar() {
    if (items.length === 0) { setError('Cargá al menos un producto'); return; }
    setError(''); setEnviando(true);
    void entregarStock(items).then((r) => {
      setEnviando(false);
      if (r.ok) { setCant({}); router.refresh(); }
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

      {error && <p aria-live="polite" className="text-lg font-semibold text-red-600">{error}</p>}

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
