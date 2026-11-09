import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BuffetMostradorResumen } from '@/lib/types';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums text-neutral-900">{valor}</div>
      <div className="text-xs text-neutral-500">{etiqueta}</div>
    </div>
  );
}

/** Lo que vendió un mostrador del buffet en el período: plata, tickets, medios de pago y lo más vendido. */
export function BuffetMostradorCard({ m }: { m: BuffetMostradorResumen }) {
  return (
    <Card className="gap-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-neutral-600">{m.nombre}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-3xl font-semibold tracking-tight text-neutral-900">{money(m.monto)}</div>
        <div className="grid grid-cols-3 gap-4">
          <Dato etiqueta="Tickets" valor={String(m.tickets)} />
          <Dato etiqueta="Unidades" valor={String(m.unidades)} />
          <Dato etiqueta="Ticket promedio" valor={money(m.ticketPromedio)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Dato etiqueta="Efectivo" valor={money(m.porMedio.EFECTIVO)} />
          <Dato etiqueta="Transferencia" valor={money(m.porMedio.TRANSFERENCIA)} />
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-neutral-500">Lo más vendido</div>
          {m.topProductos.length === 0 ? (
            <p className="text-sm text-neutral-500">Sin ventas en el período.</p>
          ) : (
            <ul className="divide-y text-sm">
              {m.topProductos.map((p) => (
                <li key={p.nombre} className="flex items-center justify-between py-1.5">
                  <span className="truncate pr-2">{p.nombre}</span>
                  <span className="shrink-0 tabular-nums text-neutral-600">{p.unidades} u · {money(p.monto)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {m.alquileres > 0 && (
          <p className="text-xs text-neutral-500">Además cobró {money(m.alquileres)} de alquileres (no suman a las ventas).</p>
        )}
      </CardContent>
    </Card>
  );
}
