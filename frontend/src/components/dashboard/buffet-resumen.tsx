import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BuffetResumen } from '@/lib/types';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/** Resumen del buffet en el período: principal y secundario juntos. El tercero es una caja aparte y no entra. */
export function BuffetResumenCard({ total }: { total: BuffetResumen['total'] }) {
  return (
    <Card className="gap-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-neutral-600">Buffet <span className="font-normal text-neutral-500">· principal y secundario</span></CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="text-sm text-neutral-600">Ventas</div>
          <div className="text-4xl font-semibold tracking-tight text-neutral-900">{money(total.monto)}</div>
          <div className="mt-1 text-sm text-neutral-500">Efectivo {money(total.porMedio.EFECTIVO)} · Transferencia {money(total.porMedio.TRANSFERENCIA)}</div>
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <div className="text-sm text-neutral-600">Productos vendidos</div>
            <div className="text-3xl font-semibold tabular-nums text-neutral-900">{total.unidades}</div>
          </div>
          <div>
            <div className="text-sm text-neutral-600">Más vendido</div>
            <div className="text-2xl font-semibold text-neutral-900">
              {total.masVendido ? `${total.masVendido.nombre} (${total.masVendido.unidades})` : '—'}
            </div>
          </div>
          <div>
            <div className="text-sm text-neutral-600">Tickets</div>
            <div className="text-3xl font-semibold tabular-nums text-neutral-900">{total.tickets}</div>
            <div className="text-xs text-neutral-500">Promedio {money(Math.round(total.ticketPromedio))}</div>
          </div>
        </div>
        {total.alquileres > 0 && (
          <p className="text-xs text-neutral-500">Además se cobraron {money(total.alquileres)} de alquileres (no suman a las ventas).</p>
        )}
      </CardContent>
    </Card>
  );
}
