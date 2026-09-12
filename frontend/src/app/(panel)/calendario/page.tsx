import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import type { Reserva, Cancha, Config, TurnoFijo, Bloqueo } from '@/lib/types';
import { semanaDe, TZ } from '@/lib/calendario';
import { resolverAperturaCierreUnificados } from '@/lib/hora';
import { CalendarioSemana } from '@/components/calendario/calendario-semana';

function hoyYMD(): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

export default async function CalendarioPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const hoy = hoyYMD();
  const ancla = sp.semana && /^\d{4}-\d{2}-\d{2}$/.test(sp.semana) ? sp.semana : hoy;
  const { lunes, domingo, dias } = semanaDe(ancla);

  const [reservas, canchas, config, fijos, bloqueos] = await Promise.all([
    apiFetch<Reserva[]>(`/reservas?desde=${lunes}&hasta=${domingo}`),
    apiFetch<Cancha[]>('/canchas'),
    apiFetch<Config>('/config'),
    apiFetch<TurnoFijo[]>('/turnos-fijos'),
    apiFetch<Bloqueo[]>('/bloqueos'),
  ]);

  const prev = addDays(lunes, -7);
  const next = addDays(lunes, 7);
  const linkCls = 'rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-50';

  const { aperturaU, cierreU } = resolverAperturaCierreUnificados(config);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendario</h1>
          <p className="mt-1 text-sm text-neutral-600">Semana del {lunes} al {domingo}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/calendario?semana=${prev}`} className={linkCls}>‹ Anterior</Link>
          <Link href="/calendario" className={linkCls}>Hoy</Link>
          <Link href={`/calendario?semana=${next}`} className={linkCls}>Siguiente ›</Link>
        </div>
      </div>

      <CalendarioSemana
        reservas={reservas}
        fijos={fijos}
        bloqueos={bloqueos}
        canchas={canchas}
        dias={dias}
        horaApertura={aperturaU}
        horaCierre={cierreU}
        hoy={hoy}
      />
    </div>
  );
}
