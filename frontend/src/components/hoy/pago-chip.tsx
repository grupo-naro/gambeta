import { estadoPago, type TonoPago } from '@/lib/pago';
import type { Reserva } from '@/lib/types';
import { cn } from '@/lib/utils';

const TONO_CLASE: Record<TonoPago, string> = {
  pagado: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  parcial: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  debe: 'bg-red-50 text-red-700 ring-red-600/20',
  espera: 'bg-neutral-100 text-neutral-600 ring-neutral-500/20',
};

export function PagoChip({ reserva, className }: { reserva: Pick<Reserva, 'estado' | 'monto' | 'pagado' | 'saldo' | 'suscripcionId' | 'montoLista'>; className?: string }) {
  const { tono, label } = estadoPago(reserva);
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset', TONO_CLASE[tono], className)}>
      {label}
    </span>
  );
}
