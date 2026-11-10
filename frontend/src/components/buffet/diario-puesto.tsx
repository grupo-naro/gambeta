import type { DiaSecundario } from '@/lib/types';
import { arrancoCon, detalleArranque, fechaCorta } from '@/lib/secundario-dia';
import { SubNavBuffet } from '@/components/buffet/sub-nav';

/** Día por día de un puesto con cupo (secundario o tercero): con cuánto arrancó, cuánto vendió y cuánto sobró. */
export function DiarioPuesto({ titulo, activa, dias }: { titulo: string; activa: 'secundario' | 'tercero'; dias: DiaSecundario[] }) {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>
        <p className="text-sm text-neutral-600">
          Día por día: con cuánto arrancó, cuánto vendió y cuánto sobró. Lo que sobra queda para el día siguiente.
        </p>
      </header>
      <SubNavBuffet activa={activa} />

      {dias.length === 0 ? (
        <p className="text-neutral-600">Todavía no hay movimientos para mostrar.</p>
      ) : dias.map((d) => (
        <article key={d.fecha} className="rounded-xl border bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">{fechaCorta(d.fecha)}</h2>
            <p className="text-sm text-neutral-700">
              Arrancó con <b className="tabular-nums">{d.totales.arranco + d.totales.entregado - d.totales.devuelto}</b>
              {' · '}Vendió <b className="tabular-nums text-emerald-700">{d.totales.vendido}</b>
              {' · '}Sobraron <b className="tabular-nums">{d.totales.quedo}</b>
            </p>
          </div>
          {d.lineas.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">Sin movimientos.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-neutral-600">
                  <th className="py-1 pr-2">Producto</th>
                  <th className="py-1 px-2 text-right">Arrancó con</th>
                  <th className="py-1 px-2 text-right">Vendió</th>
                  <th className="py-1 pl-2 text-right">Sobraron</th>
                </tr>
              </thead>
              <tbody>
                {d.lineas.map((l) => (
                  <tr key={l.productoId} className="border-b last:border-0 align-top">
                    <td className="py-1.5 pr-2">
                      {l.nombre}
                      {detalleArranque(l) && <span className="block text-xs text-neutral-500">{detalleArranque(l)}</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{arrancoCon(l)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{l.vendido}</td>
                    <td className="py-1.5 pl-2 text-right font-medium tabular-nums">{l.quedo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
      ))}
    </div>
  );
}
