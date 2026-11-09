import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AcademiaResumen } from '@/lib/types';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

/** Resumen de la academia: lo cobrado en el período y lo que se debe hoy. */
export function AcademiaResumenCard({ total }: { total: AcademiaResumen['total'] }) {
  return (
    <Card className="gap-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-neutral-600">Academia</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="text-sm text-neutral-600">Cobrado en el período</div>
          <div className="text-4xl font-semibold tracking-tight text-neutral-900">{money(total.cobrado)}</div>
          <div className="mt-1 text-sm text-neutral-500">Efectivo {money(total.porMedio.EFECTIVO)} · Transferencia {money(total.porMedio.TRANSFERENCIA)}</div>
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <div className="text-sm text-neutral-600">A cobrar (meses sin pagar)</div>
            <div className={`text-3xl font-semibold tabular-nums ${total.debe > 0 ? 'text-amber-700' : 'text-neutral-900'}`}>{money(total.debe)}</div>
            <div className="text-xs text-neutral-500">Hasta el mes actual, sin importar el período elegido</div>
          </div>
          <div>
            <div className="text-sm text-neutral-600">Entrenamientos</div>
            <div className="text-3xl font-semibold tabular-nums text-neutral-900">{total.entrenamientos}</div>
            <div className="text-xs text-neutral-500">Con valor mensual</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
