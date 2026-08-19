import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { Alquiler, EstadoAlquiler } from '@/lib/types';
import { SubNavAlquileres } from '@/components/alquileres/sub-nav';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

const FILTROS: { clave: '' | EstadoAlquiler; label: string }[] = [
  { clave: '', label: 'Todos' },
  { clave: 'ENTREGADO', label: 'Afuera' },
  { clave: 'DEVUELTO', label: 'Devueltos' },
  { clave: 'PERDIDO', label: 'Perdidos' },
  { clave: 'ROTO', label: 'Rotos' },
];

export default async function MovimientosAlquileresPage({
  searchParams,
}: { searchParams: Promise<{ desde?: string; hasta?: string; estado?: EstadoAlquiler }> }) {
  await requireAdmin();
  const { desde, hasta, estado } = await searchParams;
  const qs = new URLSearchParams();
  if (desde) qs.set('desde', desde);
  if (hasta) qs.set('hasta', hasta);
  if (estado) qs.set('estado', estado);
  const movimientos = await apiFetch<Alquiler[]>(`/alquileres${qs.size ? `?${qs}` : ''}`);

  const afuera = movimientos.filter((m) => m.estado === 'ENTREGADO');
  const perdidos = movimientos.filter((m) => m.estado === 'PERDIDO' || m.estado === 'ROTO');

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Movimientos de alquileres</h1>
      </header>
      <SubNavAlquileres activa="movimientos" />

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-neutral-600">Afuera ahora</p>
          <p className="text-2xl font-semibold tabular-nums">{afuera.length}</p>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm text-neutral-600">Perdidos o rotos</p>
          <p className="text-2xl font-semibold tabular-nums">{perdidos.length}</p>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3">
        <label className="text-sm">Desde
          <input type="date" name="desde" defaultValue={desde} className="ml-2 rounded-lg border px-2 py-1" />
        </label>
        <label className="text-sm">Hasta
          <input type="date" name="hasta" defaultValue={hasta} className="ml-2 rounded-lg border px-2 py-1" />
        </label>
        <select name="estado" defaultValue={estado ?? ''} className="rounded-lg border px-2 py-1 text-sm">
          {FILTROS.map((f) => <option key={f.clave} value={f.clave}>{f.label}</option>)}
        </select>
        <button type="submit" className="rounded-lg bg-neutral-900 px-3 py-1 text-sm font-medium text-white">Filtrar</button>
      </form>

      {movimientos.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay movimientos para ese filtro.</p>
      ) : (
        <div className="space-y-2">
          {movimientos.map((m) => (
            <article key={m.id} className="rounded-xl border bg-white p-3">
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{m.articuloNombre} ×{m.cantidad}</span>
                <span className="tabular-nums">{money(m.total)}</span>
              </div>
              <p className="text-sm text-neutral-600">
                {m.quienRetira} · {fmt(m.entregadoEn)} · {m.estado.toLowerCase()}
                {m.garantia && ` · garantía: ${m.garantia}`}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
