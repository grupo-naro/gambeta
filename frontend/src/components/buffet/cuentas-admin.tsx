import Link from 'next/link';
import type { CuentaBuffet, EstadoCuentaBuffet } from '@/lib/types';
import { etiquetaEstado } from '@/components/mostrador/cuenta-reglas';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const FILTROS: { clave: '' | EstadoCuentaBuffet; label: string }[] = [
  { clave: '', label: 'Todas' },
  { clave: 'ABIERTA', label: 'Abiertas' },
  { clave: 'RENDIDA', label: 'Rendidas' },
  { clave: 'IMPAGA', label: 'Impagas' },
  { clave: 'CANCELADA', label: 'Canceladas' },
];

const COLOR: Record<EstadoCuentaBuffet, string> = {
  ABIERTA: 'bg-emerald-100 text-emerald-800',
  RENDIDA: 'bg-neutral-100 text-neutral-700',
  CANCELADA: 'bg-neutral-100 text-neutral-500',
  // Una impaga es plata que se fue: resalta.
  IMPAGA: 'bg-amber-200 text-amber-900',
};

/** Lista de solo lectura de las cuentas por cancha de todos los mostradores. */
export function CuentasAdmin({ cuentas, filtro }: { cuentas: CuentaBuffet[]; filtro: '' | EstadoCuentaBuffet }) {
  return (
    <>
      <nav className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <Link key={f.clave} href={f.clave ? `/buffet/cuentas?estado=${f.clave}` : '/buffet/cuentas'}
            className={`rounded-lg px-3 py-1 text-sm font-medium ${f.clave === filtro ? 'bg-neutral-900 text-white' : 'border text-neutral-700'}`}>
            {f.label}
          </Link>
        ))}
      </nav>

      {cuentas.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay cuentas para mostrar.</p>
      ) : (
        <ul className="space-y-3">
          {cuentas.map((c) => (
            <li key={c.id} className={`rounded-lg border bg-white p-4 ${c.estado === 'IMPAGA' ? 'border-amber-400' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {c.canchaNombre}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${COLOR[c.estado]}`}>{etiquetaEstado(c.estado)}</span>
                </p>
                <p className="text-lg font-semibold tabular-nums">{money(c.total)}</p>
              </div>
              <p className="mt-1 text-sm text-neutral-600">
                Abierta {fmt(c.abiertaEn)}{c.cerradaEn ? ` · cerrada ${fmt(c.cerradaEn)}` : ''}
                {c.reserva ? ` · ${c.reserva.clienteNombre} (${c.reserva.horaInicio}–${c.reserva.horaFin})` : ''}
              </p>
              {c.lineas.length > 0 && (
                <p className="mt-2 text-sm text-neutral-700">{c.lineas.map((l) => `${l.cantidad} × ${l.nombre}`).join(' · ')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
