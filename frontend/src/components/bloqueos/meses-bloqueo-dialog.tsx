'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getMesesBloqueo } from '@/lib/cobros-actions';
import { estadoMes, etiquetaMes, type MesesBloqueo } from '@/lib/meses-bloqueo';
import { CobrosDialog } from '@/components/reservas/cobros-dialog';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
const TONO = { verde: 'text-emerald-700', ambar: 'text-amber-700' } as const;

/**
 * Los meses de un entrenamiento recurrente (5 meses atrás a 1 adelante, dentro de su período), cada
 * uno con lo que debe. Tocar un mes abre sus cobros: el valor es mensual y se marca pago mes a mes.
 */
export function MesesBloqueoDialog({ bloqueoId, titulo, open, onOpenChange }: { bloqueoId: string | null; titulo: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [data, setData] = useState<MesesBloqueo | null>(null);
  const [mes, setMes] = useState<string | null>(null);

  // Al volver de los cobros de un mes (mes pasa a null) se recarga la lista con lo recién cobrado.
  useEffect(() => {
    if (!open || !bloqueoId) return;
    let cancelled = false;
    getMesesBloqueo(bloqueoId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) toast.error('No pude cargar los meses'); });
    return () => { cancelled = true; };
  }, [open, bloqueoId, mes]);

  function handleOpenChange(next: boolean) {
    if (!next) { setData(null); setMes(null); }
    onOpenChange(next);
  }

  const meses = data?.meses ?? [];
  const debe = meses.filter((m) => m.saldo > 0).length;

  return (
    <>
      <Dialog open={open && mes === null} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cobros por mes</DialogTitle>
            <p className="text-sm text-neutral-600">{titulo}{data?.valor != null ? ` · ${money(data.valor)} por mes` : ''}</p>
          </DialogHeader>
          {!data ? <p className="text-sm text-neutral-600">Cargando…</p> : meses.length === 0 ? (
            <p className="text-sm text-neutral-600">No hay meses en el período de este entrenamiento.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{debe === 0 ? 'No hay meses con deuda.' : `${debe} ${debe === 1 ? 'mes con deuda' : 'meses con deuda'}.`} Tocá un mes para registrar un pago.</p>
              <ul className="max-h-80 space-y-1 overflow-y-auto">
                {meses.map((m) => {
                  const e = estadoMes(m);
                  return (
                    <li key={m.mes}>
                      <button type="button" onClick={() => setMes(m.mes)} className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-neutral-50">
                        <span className="font-medium">{etiquetaMes(m.mes)}</span>
                        <span className={`text-xs font-medium ${TONO[e.tono]}`}>{e.texto}{m.pagado > 0 && m.saldo > 0 ? ` (pagó ${money(m.pagado)})` : ''}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </DialogContent>
      </Dialog>
      <CobrosDialog bloqueoId={bloqueoId} bloqueoMes={mes} open={open && mes !== null} onOpenChange={(o) => { if (!o) setMes(null); }} />
    </>
  );
}
