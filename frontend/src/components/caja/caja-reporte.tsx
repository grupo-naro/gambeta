'use client';
import { Badge } from '@/components/ui/badge';
import type { CajaReporte } from '@/lib/types';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const conceptoLabel = (c: 'TURNO' | 'CUOTA' | 'ABONO' | 'EVENTO' | 'ACADEMIA') => c === 'CUOTA' ? 'Cuota de socio' : c === 'ABONO' ? 'Abono de fijo' : c === 'EVENTO' ? 'Evento' : c === 'ACADEMIA' ? 'Academia' : 'Turno';

export function CajaReporteView({ caja }: { caja: CajaReporte }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-white p-4"><div className="text-xs text-neutral-600">Total</div><div className="text-xl font-semibold">{money(caja.total)}</div></div>
        <div className="rounded-lg border bg-white p-4"><div className="text-xs text-neutral-600">Efectivo</div><div className="text-xl font-semibold">{money(caja.porMedio.EFECTIVO)}</div></div>
        <div className="rounded-lg border bg-white p-4"><div className="text-xs text-neutral-600">Transferencia</div><div className="text-xl font-semibold">{money(caja.porMedio.TRANSFERENCIA)}</div></div>
      </div>
      {/* Turnos vs cuotas de socios vs abonos de fijos: sin este desglose el total de caja no se
          puede explicar contra la suma de los turnos del día, porque cuotas y abonos no tienen
          cancha (o el turno que originan sale en $0). */}
      {(caja.porConcepto.cuotas > 0 || caja.porConcepto.abonos > 0 || caja.porConcepto.eventos > 0 || (caja.porConcepto.academia ?? 0) > 0) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-lg border bg-white p-4"><div className="text-xs text-neutral-600">Turnos</div><div className="text-lg font-semibold">{money(caja.porConcepto.turnos)}</div></div>
          <div className="rounded-lg border bg-white p-4"><div className="text-xs text-neutral-600">Cuotas de socios</div><div className="text-lg font-semibold">{money(caja.porConcepto.cuotas)}</div></div>
          <div className="rounded-lg border bg-white p-4"><div className="text-xs text-neutral-600">Abonos de fijos</div><div className="text-lg font-semibold">{money(caja.porConcepto.abonos)}</div></div>
          <div className="rounded-lg border bg-white p-4"><div className="text-xs text-neutral-600">Eventos</div><div className="text-lg font-semibold">{money(caja.porConcepto.eventos ?? 0)}</div></div>
          <div className="rounded-lg border bg-white p-4"><div className="text-xs text-neutral-600">Academia</div><div className="text-lg font-semibold">{money(caja.porConcepto.academia ?? 0)}</div></div>
        </div>
      )}
      {caja.porCancha.length > 0 && (
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-2 text-xs text-neutral-600">Por cancha</div>
          <ul className="space-y-1 text-sm">{caja.porCancha.map((c) => <li key={c.canchaId} className="flex justify-between"><span>{c.nombre}</span><span className="font-medium">{money(c.total)}</span></li>)}</ul>
        </div>
      )}
      {/* Detalle */}
      <div className="hidden overflow-x-auto rounded-lg border bg-white md:block">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-neutral-600"><th className="p-3">Hora</th><th className="p-3">Concepto</th><th className="p-3">Cancha</th><th className="p-3">Cliente</th><th className="p-3">Medio</th><th className="p-3 text-right">Monto</th></tr></thead>
          <tbody>{caja.cobros.map((c) => (
            <tr key={c.id} className="border-b last:border-0"><td className="p-3 text-neutral-600">{fmt(c.creadoEn)}</td><td className="p-3">{conceptoLabel(c.concepto)}</td><td className="p-3">{c.cancha}</td><td className="p-3">{c.cliente}</td><td className="p-3"><Badge variant="secondary">{c.medio === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}</Badge></td><td className="p-3 text-right font-medium">{money(c.monto)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {caja.cobros.map((c) => (
          <div key={c.id} className="rounded-lg border bg-white p-3 text-sm">
            <div className="flex justify-between"><span className="font-medium">{money(c.monto)}</span><span className="text-xs text-neutral-500">{fmt(c.creadoEn)}</span></div>
            <div className="text-neutral-600">{c.concepto === 'TURNO' ? c.cancha : conceptoLabel(c.concepto)} · {c.cliente}</div>
            <Badge variant="secondary" className="mt-1">{c.medio === 'EFECTIVO' ? 'Efectivo' : 'Transferencia'}</Badge>
          </div>
        ))}
        {caja.cobros.length === 0 && <p className="rounded-lg border bg-white p-6 text-center text-sm text-neutral-600">Sin cobros.</p>}
      </div>
    </div>
  );
}
