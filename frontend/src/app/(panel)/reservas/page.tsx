import { apiFetch } from '@/lib/api';
import type { Reserva, Cancha, AgendaDia, Config } from '@/lib/types';
import { parseFiltros } from '@/lib/fecha';
import { ReservasTable } from '@/components/reservas/reservas-table';
import { NuevaReservaDialog } from '@/components/reservas/nueva-reserva-dialog';

const ESTADOS = ['', 'CONFIRMADA', 'ESPERANDO_SENA', 'CANCELADA', 'COMPLETADA'] as const;

export default async function ReservasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const f = parseFiltros(await searchParams);
  const canchas = await apiFetch<Cancha[]>('/canchas');
  const config = await apiFetch<Config>('/config');
  const qs = new URLSearchParams({ fecha: f.fecha, ...(f.canchaId && { canchaId: f.canchaId }), ...(f.estado && { estado: f.estado }) });
  const reservas = await apiFetch<Reserva[]>(`/reservas?${qs.toString()}`);

  const agenda = await apiFetch<AgendaDia>(`/agenda?fecha=${f.fecha}`);
  const fijos = f.canchaId ? agenda.fijos.filter((x) => x.canchaId === f.canchaId) : agenda.fijos;
  const bloqueos = f.canchaId ? agenda.bloqueos.filter((x) => x.canchaId === f.canchaId) : agenda.bloqueos;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reservas</h1>
        <NuevaReservaDialog canchas={canchas} senaMontoFijo={Number(config.senaMontoFijo)} />
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
        <label className="flex flex-col text-sm">Fecha
          <input type="date" name="fecha" defaultValue={f.fecha} className="mt-1 rounded-md border px-2 py-1.5" />
        </label>
        <label className="flex flex-col text-sm">Cancha
          <select name="canchaId" defaultValue={f.canchaId} className="mt-1 rounded-md border px-2 py-1.5">
            <option value="">Todas</option>
            {canchas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-sm">Estado
          <select name="estado" defaultValue={f.estado} className="mt-1 rounded-md border px-2 py-1.5">
            {ESTADOS.map((e) => <option key={e} value={e}>{e === '' ? 'Todos' : e}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white">Filtrar</button>
      </form>

      <ReservasTable reservas={reservas} fijos={fijos} bloqueos={bloqueos} />
    </div>
  );
}
