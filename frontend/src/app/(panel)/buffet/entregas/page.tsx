import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { EntregaPanel } from '@/lib/types';
import { SubNavBuffet } from '@/components/buffet/sub-nav';

const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

export default async function EntregasPage() {
  await requireAdmin();
  const entregas = await apiFetch<EntregaPanel[]>('/buffet/entregas');

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Entregas al secundario</h1>
        <p className="text-sm text-neutral-600">
          Últimos 90 días. Dos entregas iguales y pegadas en el tiempo pueden ser un doble toque.
        </p>
      </header>
      <SubNavBuffet activa="entregas" />

      {entregas.length === 0 ? (
        <p className="text-neutral-600">No hay entregas en este período.</p>
      ) : (
        <ul className="space-y-2">
          {entregas.map((e) => (
            <li key={e.id} className="rounded-xl border bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-neutral-600">{fmt(e.creadaEn)}</span>
                <span className={`text-xs font-medium ${e.conciliada ? 'text-neutral-500' : 'text-amber-700'}`}>
                  {e.conciliada ? 'rendida' : 'pendiente de rendir'}
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {e.lineas.map((l) => (
                  <li key={l.productoId}>{l.nombre} × <span className="tabular-nums">{l.cantidad}</span></li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
