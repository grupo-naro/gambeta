import { apiFetch } from '@/lib/api';
import { getSession } from '@/lib/session';
import type { CajaReporte } from '@/lib/types';
import { CajaReporteView } from '@/components/caja/caja-reporte';

function hoy() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export default async function CajaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  const esAdmin = session.rol === 'ADMIN';
  const hoyYmd = hoy();
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const desde = esAdmin && sp.desde && re.test(sp.desde) ? sp.desde : hoyYmd;
  const hasta = esAdmin && sp.hasta && re.test(sp.hasta) ? sp.hasta : (esAdmin ? desde : hoyYmd);
  const caja = await apiFetch<CajaReporte>(`/caja?desde=${desde}&hasta=${hasta}`);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Caja</h1>
          <p className="mt-1 text-sm text-neutral-600">{esAdmin ? `Del ${caja.desde} al ${caja.hasta}` : 'Cobros de hoy'}</p>
        </div>
        {esAdmin && (
          <form method="get" className="flex items-end gap-2 text-sm">
            <label className="flex flex-col">Desde<input type="date" name="desde" defaultValue={desde} className="mt-1 rounded-md border px-2 py-1.5" /></label>
            <label className="flex flex-col">Hasta<input type="date" name="hasta" defaultValue={hasta} className="mt-1 rounded-md border px-2 py-1.5" /></label>
            <button type="submit" className="rounded-md bg-neutral-900 px-3 py-2 text-white">Ver</button>
          </form>
        )}
      </div>
      <CajaReporteView caja={caja} />
    </div>
  );
}
