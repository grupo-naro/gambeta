import { CalendarClock } from 'lucide-react';
import type { FijoAgenda, Cancha } from '@/lib/types';
import { colorDeCancha, nombreCancha, ESTILO_TIPO } from '@/lib/calendario';
import { cn } from '@/lib/utils';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');

export function FijoCard({ fijo, canchas, fecha, onClick }: { fijo: FijoAgenda; canchas: Cancha[]; fecha: string; onClick: () => void }) {
  const col = colorDeCancha(fijo.canchaId, canchas);
  // Este es el estado normal de un fijo con abono durante todo el día, antes de materializarse
  // (cobrarse en $0): el aviso tiene que poder dispararse acá, no solo en TurnoCard. Mismo
  // criterio que turno-card.tsx: se compara contra el día que se está mirando, no contra hoy.
  const abonoVencido = fijo.abonoHasta != null && fijo.abonoHasta < fecha;
  // Con abono el turno se va a materializar en $0: mostrar el precio de la cancha es engañoso.
  const precio = fijo.conAbono ? 0 : fijo.precio;
  return (
    <button onClick={onClick} className={cn('flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition hover:brightness-95', ESTILO_TIPO.fijo.card)}>
      <CalendarClock className={cn('h-5 w-5 flex-none', ESTILO_TIPO.fijo.icono)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{fijo.horaInicio}–{fijo.horaFin}</p>
        <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-neutral-600">
          <span className={cn('inline-block rounded px-1.5 py-0.5 font-medium', col.bg, col.text)}>{nombreCancha(fijo.cancha.nombre)}</span>
          Fijo · {fijo.clienteNombre}
        </p>
        {abonoVencido && (
          <span className="mt-1 inline-block rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">
            ABONO VENCIDO — RENOVAR
          </span>
        )}
      </div>
      <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium', ESTILO_TIPO.fijo.badge)}>Fijo · {money(precio)}</span>
    </button>
  );
}
