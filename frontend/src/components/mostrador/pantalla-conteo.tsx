'use client';
import { useState } from 'react';
import { conciliarCaja } from '@/lib/buffet-actions';
import { diferencia } from '@/lib/mostrador-stock';
import type { LineaConciliacion } from '@/lib/types';

type Cerrada = (LineaConciliacion & { contado: number; diferencia: number })[];

export function PantallaConteo({ cajaId, lineas }: { cajaId: string; lineas: LineaConciliacion[] }) {
  const [contado, setContado] = useState<Record<string, number>>({});
  const [resultado, setResultado] = useState<Cerrada | null>(null);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  function confirmar() {
    const conteos = lineas.map((l) => ({ productoId: l.productoId, contado: contado[l.productoId] ?? 0 }));
    // Es irreversible (el backend rechaza un segundo intento con 409) y el default de un input
    // vacío es 0, o sea "faltó todo". Un tap sin querer sobre un botón que ya está habilitado
    // registraría cada línea entera como faltante. El resumen deja ver eso antes de mandarlo,
    // igual que "Cerrar caja" en la pantalla de venta.
    const vuelven = conteos.reduce((a, c) => a + c.contado, 0);
    const faltan = lineas.reduce((a, l) => a + Math.max(0, l.esperado - (contado[l.productoId] ?? 0)), 0);
    if (!confirm(`¿Confirmar el conteo?\n\nVuelven ${vuelven} unidades al stock general.\n${faltan > 0 ? `Se registran ${faltan} como faltantes.` : 'No hay faltantes.'}\n\nNo se puede deshacer.`)) return;
    setError(''); setEnviando(true);
    void conciliarCaja(cajaId, conteos).then((r) => {
      setEnviando(false);
      if (r.ok) setResultado(r.data.lineas);
      else setError(r.error);
    });
  }

  if (resultado) {
    return (
      <main className="flex min-h-screen flex-col gap-4 p-4">
        <h1 className="text-xl font-bold">Cierre conciliado</h1>
        <ul className="divide-y rounded-2xl border bg-white">
          {resultado.map((l) => (
            <li key={l.productoId} className="flex items-center justify-between p-3">
              <span className="font-semibold">{l.nombre}</span>
              <span className={l.diferencia === 0 ? 'text-neutral-600' : 'font-bold text-red-600'}>
                {l.diferencia === 0 ? 'sin diferencia' : `${l.diferencia > 0 ? '+' : ''}${l.diferencia}`}
              </span>
            </li>
          ))}
        </ul>
        <a href="/mostrador" className="rounded-2xl bg-emerald-600 py-4 text-center text-lg font-bold text-white">Listo</a>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <header>
        <h1 className="text-xl font-bold">Contar el cierre</h1>
        {/* Es contraintuitivo y hay que decirlo: si faltan unidades, al general vuelven las que
            hay, no las que deberian estar. El faltante queda registrado en el historico. */}
        <p className="text-sm text-neutral-600">
          Contá lo que quedó físicamente. Vuelve al stock general lo que contás, no lo esperado.
        </p>
      </header>

      <p aria-live="polite" className={error ? 'text-lg font-semibold text-red-600' : 'sr-only'}>{error}</p>

      <ul className="divide-y rounded-2xl border bg-white">
        {lineas.map((l) => {
          const c = contado[l.productoId];
          const dif = c == null ? null : diferencia(l.esperado, c);
          return (
            <li key={l.productoId} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="font-semibold">{l.nombre}</p>
                <p className="text-sm text-neutral-600">
                  Entregado {l.entregado} · vendido {l.vendido} · deberían quedar <b>{l.esperado}</b>
                </p>
                {dif != null && dif !== 0 && (
                  <p className="text-sm font-semibold text-red-600">
                    {dif > 0 ? `Sobran ${dif}` : `Faltan ${Math.abs(dif)}`}
                  </p>
                )}
              </div>
              <input
                inputMode="numeric"
                aria-label={`Contado de ${l.nombre}`}
                value={contado[l.productoId] ?? ''}
                onChange={(e) => setContado((s) => ({ ...s, [l.productoId]: Number(e.target.value.replace(/\D/g, '')) || 0 }))}
                placeholder="0"
                className="w-20 rounded-xl border p-2 text-center text-lg"
              />
            </li>
          );
        })}
      </ul>

      {lineas.length === 0 && <p className="text-neutral-600">Esta caja no tiene nada para conciliar.</p>}

      <button
        type="button"
        onClick={confirmar}
        disabled={enviando || lineas.length === 0}
        className="rounded-2xl bg-emerald-600 py-4 text-lg font-bold text-white disabled:opacity-50"
      >
        {enviando ? 'Guardando…' : 'Confirmar conteo'}
      </button>
    </main>
  );
}
