'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getClasesBloqueo } from '@/lib/cobros-actions';
import { estadoClase, etiquetaClase, type ClasesBloqueo } from '@/lib/clases-bloqueo';
import { CobrosDialog } from '@/components/reservas/cobros-dialog';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
const TONO = { verde: 'text-emerald-700', ambar: 'text-amber-700', gris: 'text-neutral-500' } as const;

/**
 * Las clases de un entrenamiento recurrente (5 semanas atrás a 2 adelante), cada una con lo que debe.
 * Tocar una abre sus cobros: el valor es por clase y se marca pagado fecha por fecha.
 */
export function ClasesBloqueoDialog({ bloqueoId, titulo, open, onOpenChange }: { bloqueoId: string | null; titulo: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [data, setData] = useState<ClasesBloqueo | null>(null);
  const [fecha, setFecha] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !bloqueoId) return;
    let cancelled = false;
    getClasesBloqueo(bloqueoId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) toast.error('No pude cargar las clases'); });
    return () => { cancelled = true; };
  }, [open, bloqueoId, fecha]);

  function handleOpenChange(next: boolean) {
    if (!next) { setData(null); setFecha(null); }
    onOpenChange(next);
  }

  const clases = data?.clases ?? [];
  const debe = clases.filter((c) => !c.liberada && c.saldo > 0).length;

  return (
    <>
      <Dialog open={open && fecha === null} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cobros por clase</DialogTitle>
            <p className="text-sm text-neutral-600">{titulo}{data?.valor != null ? ` · ${money(data.valor)} por clase` : ''}</p>
          </DialogHeader>
          {!data ? <p className="text-sm text-neutral-600">Cargando…</p> : clases.length === 0 ? (
            <p className="text-sm text-neutral-600">No hay clases en estas fechas.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{debe === 0 ? 'No hay clases con deuda.' : `${debe} ${debe === 1 ? 'clase con deuda' : 'clases con deuda'}.`} Tocá una clase para registrar un pago.</p>
              <ul className="max-h-80 space-y-1 overflow-y-auto">
                {clases.map((c) => {
                  const e = estadoClase(c);
                  return (
                    <li key={c.fecha}>
                      <button type="button" disabled={c.liberada} onClick={() => setFecha(c.fecha)} className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm enabled:hover:bg-neutral-50 disabled:opacity-60">
                        <span className="font-medium">{etiquetaClase(c.fecha)}</span>
                        <span className={`text-xs font-medium ${TONO[e.tono]}`}>{e.texto}{!c.liberada && c.pagado > 0 && c.saldo > 0 ? ` (pagó ${money(c.pagado)})` : ''}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </DialogContent>
      </Dialog>
      <CobrosDialog bloqueoId={bloqueoId} bloqueoFecha={fecha} open={open && fecha !== null} onOpenChange={(o) => { if (!o) setFecha(null); }} />
    </>
  );
}
