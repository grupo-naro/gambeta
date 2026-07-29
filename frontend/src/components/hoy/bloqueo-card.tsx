import { Ban } from 'lucide-react';
import type { Bloqueo, Cancha } from '@/lib/types';
import { etiquetaMotivo, colorDeCancha, nombreCancha, ESTILO_TIPO } from '@/lib/calendario';
import { cn } from '@/lib/utils';

export function BloqueoCard({ bloqueo, canchas }: { bloqueo: Bloqueo; canchas: Cancha[] }) {
  const col = colorDeCancha(bloqueo.canchaId, canchas);
  return (
    <div className={cn('flex items-center gap-3 rounded-xl px-4 py-3', ESTILO_TIPO.bloqueo.card)}>
      <Ban className={cn('h-5 w-5 flex-none', ESTILO_TIPO.bloqueo.icono)} />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-neutral-700">
          {bloqueo.horaInicio}–{bloqueo.horaFin}
          <span className={cn('inline-block rounded px-1.5 py-0.5 text-xs font-medium', col.bg, col.text)}>{nombreCancha(bloqueo.cancha?.nombre)}</span>
        </p>
        <p className={cn('truncate text-xs font-medium', ESTILO_TIPO.bloqueo.texto)}>
          {etiquetaMotivo(bloqueo.motivo)}{bloqueo.nota ? ` · ${bloqueo.nota}` : ''}
        </p>
      </div>
    </div>
  );
}
