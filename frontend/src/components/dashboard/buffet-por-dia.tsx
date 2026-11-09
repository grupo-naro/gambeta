'use client';
import { Fragment, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { diaSinVentas, etiquetaDia, maximoDelPeriodo, porcentajeBarra } from '@/lib/dashboard-buffet';
import type { BuffetDia } from '@/lib/types';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/**
 * Ventas del buffet día por día, con una barra contra el mejor día del período. Cada día con ventas se
 * abre para ver lo que vendió cada mostrador y los productos de ese día.
 */
export function BuffetPorDia({ dias }: { dias: BuffetDia[] }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const max = maximoDelPeriodo(dias);
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm font-medium text-neutral-600">Ventas por día</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left font-medium">
              <th className="px-2 py-2">Día</th>
              <th className="px-2 py-2" />
              <th className="px-2 py-2 text-right">Unid.</th>
              <th className="px-2 py-2 text-right">Efectivo</th>
              <th className="px-2 py-2 text-right">Transf.</th>
              <th className="px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {dias.map((d) => {
              const vacio = diaSinVentas(d);
              const abierta = abierto === d.fecha;
              return (
                <Fragment key={d.fecha}>
                  <tr
                    className={cn('border-b', vacio ? 'text-neutral-400' : 'cursor-pointer hover:bg-neutral-50')}
                    onClick={vacio ? undefined : () => setAbierto(abierta ? null : d.fecha)}
                    aria-expanded={vacio ? undefined : abierta}
                  >
                    <td className="whitespace-nowrap px-2 py-3 font-medium">
                      <span className="inline-flex items-center gap-1">
                        {vacio ? <span className="inline-block w-4" /> : <ChevronRight className={cn('h-4 w-4 transition-transform', abierta && 'rotate-90')} />}
                        {etiquetaDia(d.fecha)}
                      </span>
                    </td>
                    <td className="w-full px-2 py-3">
                      <div className="h-2 rounded-full bg-neutral-100">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${porcentajeBarra(d.total, max)}%` }} />
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums">{d.unidades}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums">{money(d.efectivo)}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-right tabular-nums">{money(d.transferencia)}</td>
                    <td className={cn('whitespace-nowrap px-2 py-3 text-right tabular-nums', !vacio && 'font-semibold')}>{money(d.total)}</td>
                  </tr>
                  {abierta && (
                    <tr className="border-b bg-neutral-50">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <div className="mb-1 text-xs font-medium text-neutral-500">Por mostrador</div>
                            <ul className="space-y-1">
                              <li className="flex justify-between"><span>Principal</span><span className="tabular-nums">{d.mostradores.PRINCIPAL.unidades} u · {money(d.mostradores.PRINCIPAL.total)}</span></li>
                              <li className="flex justify-between"><span>Secundario</span><span className="tabular-nums">{d.mostradores.SECUNDARIO.unidades} u · {money(d.mostradores.SECUNDARIO.total)}</span></li>
                            </ul>
                          </div>
                          <div>
                            <div className="mb-1 text-xs font-medium text-neutral-500">Productos del día</div>
                            <ul className="space-y-1">
                              {d.productos.map((p) => (
                                <li key={p.nombre} className="flex justify-between gap-3"><span className="truncate">{p.nombre}</span><span className="shrink-0 tabular-nums">{p.unidades} u · {money(p.monto)}</span></li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
