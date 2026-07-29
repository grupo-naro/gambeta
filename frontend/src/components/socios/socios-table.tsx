'use client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { EstadoSuscripcionVista, Suscripcion } from '@/lib/types';

const TONO: Record<EstadoSuscripcionVista, string> = {
  ACTIVA: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  VENCIDA: 'bg-neutral-100 text-neutral-600 ring-neutral-500/20',
  CANCELADA: 'bg-red-50 text-red-700 ring-red-600/20',
};
const LABEL: Record<EstadoSuscripcionVista, string> = { ACTIVA: 'Activa', VENCIDA: 'Vencida', CANCELADA: 'Cancelada' };

function EstadoBadge({ estado }: { estado: EstadoSuscripcionVista }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', TONO[estado])}>
      {LABEL[estado]}
    </span>
  );
}

/** '2026-08-01' → '01/08/2026' sin pasar por Date (evita corrimientos de zona horaria). */
function fmt(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

export function SociosTable({ socios }: { socios: Suscripcion[] }) {
  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Socios</h1>
      </div>

      {socios.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay socios todavía.</p>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden md:block rounded-lg border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Vigencia</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Turnos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {socios.map((s) => (
                  <TableRow key={s.id} className="hover:bg-neutral-50">
                    <TableCell className="font-medium">{s.cliente.nombre}</TableCell>
                    <TableCell className="text-neutral-600">{s.cliente.whatsapp}</TableCell>
                    <TableCell>{fmt(s.inicio)} – {fmt(s.vencimiento)}</TableCell>
                    <TableCell><EstadoBadge estado={s.estadoVista} /></TableCell>
                    <TableCell>{s.turnosBonificados}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile */}
          <div className="md:hidden space-y-3">
            {socios.map((s) => (
              <div key={s.id} className="rounded-lg border bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{s.cliente.nombre}</span>
                  <EstadoBadge estado={s.estadoVista} />
                </div>
                <p className="mt-2 text-sm text-neutral-600">{fmt(s.inicio)} – {fmt(s.vencimiento)}</p>
                <p className="text-xs text-neutral-500">{s.turnosBonificados} turnos bonificados</p>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
