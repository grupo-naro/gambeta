import { Badge } from '@/components/ui/badge';
import type { EstadoReserva } from '@/lib/types';

const MAP: Record<EstadoReserva, { label: string; className: string }> = {
  CONFIRMADA: { label: 'Confirmada', className: 'bg-green-100 text-green-800 hover:bg-green-100' },
  ESPERANDO_SENA: { label: 'Esperando seña', className: 'bg-amber-100 text-amber-800 hover:bg-amber-100' },
  CANCELADA: { label: 'Cancelada', className: 'bg-neutral-200 text-neutral-700 hover:bg-neutral-200' },
  COMPLETADA: { label: 'Completada', className: 'bg-blue-100 text-blue-800 hover:bg-blue-100' },
};

export function EstadoBadge({ estado }: { estado: EstadoReserva }) {
  const c = MAP[estado];
  return <Badge variant="secondary" className={c.className}>{c.label}</Badge>;
}
