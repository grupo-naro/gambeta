import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { CierreBuffet } from '@/lib/types';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

export default async function CierresBuffetPage() {
  await requireAdmin();
  const cierres = await apiFetch<CierreBuffet[]>('/buffet/cajas');
  if (cierres.length === 0) return <p className="text-neutral-600">Todavía no hay cajas cerradas.</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Cierres del buffet</h1>
      {cierres.map((c) => (
        <article key={c.id} className="rounded-xl border bg-white p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-neutral-600">{fmt(c.cerradaEn)}</span>
            <span className="text-lg font-semibold tabular-nums">{money(c.totalMonto)}</span>
          </div>
          <p className="text-sm text-neutral-600">{c.totalUnidades} productos</p>
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
