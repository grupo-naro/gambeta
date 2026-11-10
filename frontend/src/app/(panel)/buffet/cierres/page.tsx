import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { CierreBuffet } from '@/lib/types';
import { SubNavBuffet } from '@/components/buffet/sub-nav';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

const FILTROS = [
  { clave: '', label: 'Todos' },
  { clave: 'mostrador-principal', label: 'Principal' },
  { clave: 'mostrador-secundario', label: 'Secundario' },
  { clave: 'mostrador-tercero', label: 'Tercero' },
] as const;

export default async function CierresBuffetPage({ searchParams }: { searchParams: Promise<{ mostradorId?: string }> }) {
  await requireAdmin();
  const { mostradorId } = await searchParams;
  const qs = mostradorId ? `?mostradorId=${encodeURIComponent(mostradorId)}` : '';
  const cierres = await apiFetch<CierreBuffet[]>(`/buffet/cajas${qs}`);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Cierres del buffet</h1>
      </header>
      <SubNavBuffet activa="cierres" />

      <nav className="flex gap-2">
        {FILTROS.map((f) => (
          <a
            key={f.clave}
            href={f.clave ? `/buffet/cierres?mostradorId=${f.clave}` : '/buffet/cierres'}
            className={`rounded-lg px-3 py-1 text-sm ${(mostradorId ?? '') === f.clave ? 'bg-neutral-900 text-white' : 'border text-neutral-700'}`}
          >
            {f.label}
          </a>
        ))}
      </nav>

      {cierres.length === 0 ? (
        <p className="text-neutral-600">No hay cajas cerradas para ese filtro.</p>
      ) : cierres.map((c) => (
        <article key={c.id} className="rounded-xl border bg-white p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-neutral-600">
              {fmt(c.cerradaEn)} · <b className="text-neutral-800">{c.mostradorNombre}</b>
            </span>
            <span className="text-lg font-semibold tabular-nums">{money(c.totalMonto)}</span>
          </div>
          <p className="text-sm text-neutral-600">{c.totalUnidades} productos</p>
          {c.totalAlquileres > 0 && (
            <p className="text-sm text-neutral-600">
              Incluye {money(c.totalAlquileres)} de alquileres
              {c.porArticulo.length > 0 && ` · ${c.porArticulo.map((a) => `${a.nombre} ×${a.unidades}`).join(' · ')}`}
            </p>
          )}
          <p className="text-sm text-neutral-600">Efectivo <span className="tabular-nums">{money(c.totalEfectivo)}</span> · Transferencia <span className="tabular-nums">{money(c.totalTransferencia)}</span></p>
          <ul className="mt-2 space-y-1 text-sm">
            {c.porProducto.map((l) => (
              <li key={l.productoId} className="flex justify-between">
                <span>{l.nombre} × {l.unidades}</span>
                <span className="tabular-nums">{money(l.monto)}</span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
