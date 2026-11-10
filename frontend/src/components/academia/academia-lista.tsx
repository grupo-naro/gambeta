'use client';
import { useMemo, useState, useTransition } from 'react';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm';
import { CobrosDialog } from '@/components/reservas/cobros-dialog';
import { MesesBloqueoDialog } from '@/components/bloqueos/meses-bloqueo-dialog';
import { ExcepcionBloqueoDialog } from '@/components/bloqueos/excepcion-bloqueo-dialog';
import { eliminarBloqueo } from '@/lib/bloqueos-actions';
import { estadoClase, filtrarClases, nombreClase } from '@/lib/academia';
import type { MesBloqueo } from '@/lib/meses-bloqueo';
import type { Bloqueo, Cancha } from '@/lib/types';
import { ClaseDialog } from './clase-dialog';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const TONO = { pago: 'text-emerald-700', debe: 'text-amber-700', 'sin-valor': 'text-neutral-500', fuera: 'text-neutral-500' } as const;

/** Las clases de la academia: buscador por nombre, estado del mes y el botón de pagar. */
export function AcademiaLista({ clases, canchas, mesesPorClase, mesActual }: { clases: Bloqueo[]; canchas: Cancha[]; mesesPorClase: Record<string, MesBloqueo[]>; mesActual: string }) {
  const [texto, setTexto] = useState('');
  const [nueva, setNueva] = useState(false);
  const [editando, setEditando] = useState<Bloqueo | null>(null);
  const [pagando, setPagando] = useState<Bloqueo | null>(null);
  const [mesesDe, setMesesDe] = useState<Bloqueo | null>(null);
  const [liberando, setLiberando] = useState<Bloqueo | null>(null);
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const visibles = useMemo(() => filtrarClases(clases, texto), [clases, texto]);

  async function eliminar(c: Bloqueo) {
    if (await confirm({ title: '¿Eliminar la clase?', description: `Vas a eliminar "${nombreClase(c)}". Se libera la cancha y no se puede deshacer.`, confirmLabel: 'Eliminar', destructive: true })) {
      start(async () => { const r = await eliminarBloqueo(c.id); if (r.ok) toast.success('Clase eliminada'); else toast.error(r.error); });
    }
  }
  const titulo = (c: Bloqueo) => `${nombreClase(c)} · ${DIAS[c.diaSemana ?? 0]} ${c.horaInicio}–${c.horaFin}`;

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Academia</h1>
        <Button onClick={() => setNueva(true)}><Plus className="mr-1 h-4 w-4" /> Nueva clase</Button>
      </div>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar clase por nombre…" className="pl-9" aria-label="Buscar clase" />
      </div>

      {clases.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">Todavía no hay clases. Creá la primera con &quot;Nueva clase&quot;.</p>
      ) : visibles.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">Ninguna clase coincide con &quot;{texto}&quot;.</p>
      ) : (
        <ul className="space-y-3">
          {visibles.map((c) => {
            const e = estadoClase(c.valor, mesesPorClase[c.id], mesActual);
            return (
              <li key={c.id} className="rounded-lg border bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{nombreClase(c)}</div>
                    <div className="text-sm text-neutral-600">{c.cancha?.nombre ?? '—'} · {DIAS[c.diaSemana ?? 0]} {c.horaInicio}–{c.horaFin}</div>
                    <div className="mt-1 text-sm">
                      {c.valor != null && <span className="text-neutral-600">{money(c.valor)} por mes · </span>}
                      <span className={`font-medium ${TONO[e.tipo]}`}>{e.texto}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {e.tipo === 'sin-valor' ? (
                      <Button size="sm" onClick={() => setEditando(c)}>Poner valor</Button>
                    ) : (
                      <Button size="sm" disabled={e.tipo === 'fuera'} onClick={() => setPagando(c)}>Pagar</Button>
                    )}
                    {c.valor != null && <Button size="sm" variant="outline" onClick={() => setMesesDe(c)}>Meses</Button>}
                    <Button size="sm" variant="outline" onClick={() => setEditando(c)}>Editar</Button>
                    <Button size="sm" variant="outline" onClick={() => setLiberando(c)}>Liberar fecha</Button>
                    <Button size="sm" variant="ghost" className="text-red-600" disabled={pending} onClick={() => eliminar(c)}>Eliminar</Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ClaseDialog open={nueva} onOpenChange={setNueva} canchas={canchas} />
      {editando && <ClaseDialog key={editando.id} clase={editando} open onOpenChange={(o) => { if (!o) setEditando(null); }} canchas={canchas} />}
      <CobrosDialog bloqueoId={pagando?.id ?? null} bloqueoMes={mesActual} open={pagando !== null} onOpenChange={(o) => { if (!o) setPagando(null); }} />
      <MesesBloqueoDialog key={mesesDe?.id ?? 'none'} bloqueoId={mesesDe?.id ?? null} titulo={mesesDe ? titulo(mesesDe) : ''} open={mesesDe !== null} onOpenChange={(o) => { if (!o) setMesesDe(null); }} />
      <ExcepcionBloqueoDialog key={liberando?.id ?? 'none'} open={liberando !== null} onOpenChange={(o) => { if (!o) setLiberando(null); }} bloqueo={liberando} />
    </>
  );
}
