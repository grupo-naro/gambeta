'use client';
import { Badge } from '@/components/ui/badge';
import type { LogActividad } from '@/lib/types';

const ACCION_LABEL: Record<string, string> = {
  APROBAR_SENA: 'Aprobó una seña', RECHAZAR_SENA: 'Rechazó una seña',
  CANCELAR_RESERVA: 'Canceló una reserva', REPROGRAMAR_RESERVA: 'Reprogramó una reserva',
  CREAR: 'Creó', EDITAR: 'Editó', ELIMINAR: 'Eliminó', ACTUALIZAR: 'Actualizó', LOGIN: 'Inició sesión',
};
const fmt = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const texto = (l: LogActividad) => l.descripcion || ACCION_LABEL[l.accion] || l.accion;

export function ActividadList({ logs }: { logs: LogActividad[] }) {
  if (logs.length === 0) return <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">Sin actividad registrada.</p>;
  return (
    <>
      {/* Desktop */}
      <div className="hidden overflow-x-auto rounded-lg border bg-white md:block">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-neutral-600">
            <th className="p-3">Cuándo</th><th className="p-3">Usuario</th><th className="p-3">Actividad</th><th className="p-3">Sección</th>
          </tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="whitespace-nowrap p-3 text-neutral-600">{fmt(l.creadoEn)}</td>
                <td className="p-3 font-medium">{l.usuario}</td>
                <td className="p-3">{texto(l)}</td>
                <td className="p-3"><Badge variant="secondary">{l.entidad}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile */}
      <div className="space-y-3 md:hidden">
        {logs.map((l) => (
          <div key={l.id} className="rounded-lg border bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{l.usuario}</span>
              <span className="text-xs text-neutral-500">{fmt(l.creadoEn)}</span>
            </div>
            <p className="mt-1 text-sm">{texto(l)}</p>
            <Badge variant="secondary" className="mt-2">{l.entidad}</Badge>
          </div>
        ))}
      </div>
    </>
  );
}
