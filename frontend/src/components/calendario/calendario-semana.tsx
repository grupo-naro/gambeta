'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { Reserva, Cancha, TurnoFijo, Bloqueo } from '@/lib/types';
import { colorDeCancha, ubicarEnTz, horasDelDia, materializar, etiquetaMotivo, ESTILO_TIPO, dividirCelda, hhmmDeMinutos, type EventoCal } from '@/lib/calendario';
import { ReprogramarDialog } from '@/components/reservas/reprogramar-dialog';
import { AccionReservaSheet } from '@/components/reservas/accion-reserva-sheet';

const DIAS_LBL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

// Shared event button used by both the desktop grid and mobile day view
function EventoBtn({ ev, canchas, onEvento }: { ev: EventoCal; canchas: Cancha[]; onEvento: (ev: EventoCal) => void }) {
  const col = colorDeCancha(ev.canchaId, canchas);
  const esReserva = ev.tipo === 'reserva';
  const esperando = ev.estado === 'ESPERANDO_SENA';
  const tag = ev.tipo === 'fijo' ? 'Fijo' : ev.tipo === 'bloqueo' ? etiquetaMotivo(ev.motivo!) : '';
  const clasesColor =
    ev.tipo === 'fijo' ? ESTILO_TIPO.fijo.cal
    : ev.tipo === 'bloqueo' ? ESTILO_TIPO.bloqueo.cal
    : `${col.bg} ${col.text} ${col.border}`;
  const cuerpo = `${ev.titulo}${ev.subtitulo ? ' · ' + ev.subtitulo : ''}`;
  return (
    <button
      onClick={() => onEvento(ev)}
      className={`block w-full truncate rounded border px-1.5 py-0.5 text-left text-[12px] leading-tight ${clasesColor} ${esReserva ? '' : 'border-dashed'} ${esperando ? 'opacity-60' : ''}`}
      title={`${cuerpo}${tag ? ' · ' + tag : ''}${esperando ? ' (seña)' : ''}`}
    >
      {tag && <span className="font-semibold uppercase tracking-wide opacity-70">{tag}: </span>}
      {cuerpo}{esperando ? ' (seña)' : ''}
    </button>
  );
}

export function CalendarioSemana({
  reservas, fijos, bloqueos, canchas, dias, horaApertura, horaCierre, hoy,
}: {
  reservas: Reserva[]; fijos: TurnoFijo[]; bloqueos: Bloqueo[]; canchas: Cancha[]; dias: string[];
  horaApertura: string; horaCierre: string; hoy: string;
}) {
  const router = useRouter();
  const [selReserva, setSelReserva] = useState<Reserva | null>(null);
  const [selInfo, setSelInfo] = useState<EventoCal | null>(null);
  const [reprogId, setReprogId] = useState<string | null>(null);
  const [selCelda, setSelCelda] = useState<{ fecha: string; hora: number; eventos: EventoCal[] } | null>(null);
  const onMas = (fecha: string, hora: number, eventos: EventoCal[]) => setSelCelda({ fecha, hora, eventos });
  const tituloCelda = (fecha: string, hora: number) => {
    const idx = dias.indexOf(fecha);
    const lbl = idx >= 0 ? `${DIAS_LBL[idx]} ${Number(fecha.slice(8, 10))}` : fecha;
    return `${lbl} · ${String(hora).padStart(2, '0')}:00`;
  };

  // Mobile day view state
  const [diaSel, setDiaSel] = useState(dias.includes(hoy) ? hoy : dias[0]);

  const horas = horasDelDia(horaApertura, horaCierre);
  const reservasById = new Map(reservas.map((r) => [r.id, r]));

  // Lista unificada de eventos (reservas no canceladas + fijos/bloqueos materializados)
  const eventos: EventoCal[] = [];
  const matPorDia = new Map<string, Set<string>>();
  for (const r of reservas) {
    if (r.estado === 'CANCELADA') continue;
    const { fecha, horaNum, minuto } = ubicarEnTz(r.fechaInicio);
    if (r.turnoFijoId) {
      const ids = matPorDia.get(fecha) ?? new Set<string>();
      ids.add(r.turnoFijoId);
      matPorDia.set(fecha, ids);
    }
    const iniMin = horaNum * 60 + minuto;
    const duracionMin = Math.round((new Date(r.fechaFin).getTime() - new Date(r.fechaInicio).getTime()) / 60000);
    eventos.push({ key: `r${r.id}`, tipo: 'reserva', fecha, horaNum, horaTexto: hhmmDeMinutos(iniMin), finTexto: hhmmDeMinutos(iniMin + duracionMin), duracionMin, esContinuacion: false, canchaId: r.cancha?.id ?? '', titulo: r.cancha?.nombre ?? '', subtitulo: r.cliente?.nombre ?? '', estado: r.estado, refId: r.id });
  }
  eventos.push(...materializar(dias, fijos, bloqueos, matPorDia));

  const porCelda = new Map<string, EventoCal[]>();
  for (const ev of eventos) {
    const k = `${ev.fecha}|${ev.horaNum}`;
    const arr = porCelda.get(k) ?? [];
    arr.push(ev);
    porCelda.set(k, arr);
  }

  function onEvento(ev: EventoCal) {
    if (ev.tipo === 'reserva') { const r = reservasById.get(ev.refId); if (r) setSelReserva(r); }
    else setSelInfo(ev);
  }

  return (
    <div className="space-y-3">
      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-neutral-600">
        {[...canchas].sort((a, b) => a.id.localeCompare(b.id)).map((c) => (
          <span key={c.id} className="flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-full ${colorDeCancha(c.id, canchas).dot}`} />
            {c.nombre}
          </span>
        ))}
        
      </div>

      {/* Desktop: Grilla 7 columnas */}
      <div className="hidden md:block overflow-x-auto rounded-lg border bg-white">
        <div className="grid min-w-[760px]" style={{ gridTemplateColumns: '64px repeat(7, 1fr)' }}>
          <div className="border-b border-r bg-neutral-50 p-2" />
          {dias.map((d, i) => (
            <div key={d} className={`border-b border-r p-2 text-center text-xs font-medium ${d === hoy ? 'bg-primary/10 text-primary' : 'bg-neutral-50 text-neutral-600'}`}>
              {DIAS_LBL[i]} {Number(d.slice(8, 10))}
            </div>
          ))}
          {horas.map((h) => (
            <FilaHora key={h} h={h} dias={dias} porCelda={porCelda} canchas={canchas} onEvento={onEvento} onMas={onMas} />
          ))}
        </div>
      </div>

      {/* Mobile: Vista de día */}
      <div className="md:hidden space-y-3">
        {/* Chips selector de día */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {dias.map((d, i) => (
            <button
              key={d}
              onClick={() => setDiaSel(d)}
              className={`flex-none rounded-lg px-3 py-2 text-center text-xs font-medium transition-colors ${d === diaSel ? 'bg-primary text-primary-foreground' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
            >
              <span className="block">{DIAS_LBL[i]}</span>
              <span className="block text-sm font-semibold">{Number(d.slice(8, 10))}</span>
            </button>
          ))}
        </div>

        {/* Filas de horas para el día seleccionado */}
        <div className="rounded-lg border bg-white">
          {horas.map((h) => {
            const evs = porCelda.get(`${diaSel}|${h}`) ?? [];
            return (
              <div key={h} className="flex min-h-12 border-b last:border-b-0">
                {/* Etiqueta de hora */}
                <div className="w-14 shrink-0 border-r bg-neutral-50 p-2 text-right text-xs text-neutral-500 pt-3">
                  {String(h).padStart(2, '0')}:00
                </div>
                {/* Eventos */}
                <div className="flex flex-1 flex-col gap-1 p-1">
                  {evs.map((ev) => (
                    <EventoBtn key={ev.key} ev={ev} canchas={canchas} onEvento={onEvento} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hoja de acción de reserva (igual que en Hoy) */}
      <AccionReservaSheet
        reserva={selReserva}
        open={selReserva !== null}
        onOpenChange={(o) => { if (!o) setSelReserva(null); }}
        onReprogramar={(id) => setReprogId(id)}
      />

      {/* Hoja de info de turno fijo / bloqueo (solo lectura) */}
      <Sheet open={!!selInfo} onOpenChange={(o) => { if (!o) setSelInfo(null); }}>
        {selInfo && (
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{selInfo.tipo === 'fijo' ? 'Turno fijo' : 'Bloqueo'}</SheetTitle>
              <p className="text-sm text-neutral-600">{selInfo.titulo} · {String(selInfo.horaNum).padStart(2, '0')}:00</p>
            </SheetHeader>
            <div className="text-sm text-neutral-600">
              <p><span className="text-xs text-neutral-500">{selInfo.tipo === 'fijo' ? 'Cliente' : 'Motivo'}</span> {selInfo.subtitulo}</p>
            </div>
            <Link
              href={selInfo.tipo === 'fijo' ? '/turnos-fijos' : '/bloqueos'}
              className="flex h-11 w-full items-center justify-center rounded-lg border text-sm font-medium hover:bg-neutral-50"
            >
              {selInfo.tipo === 'fijo' ? 'Editar en Turnos fijos' : 'Editar en Bloqueos'}
            </Link>
          </SheetContent>
        )}
      </Sheet>

      {/* Hoja "+N más": todas las reservas de una hora/día */}
      <Sheet open={!!selCelda} onOpenChange={(o) => { if (!o) setSelCelda(null); }}>
        {selCelda && (
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{tituloCelda(selCelda.fecha, selCelda.hora)}</SheetTitle>
              <p className="text-sm text-neutral-600">{selCelda.eventos.length} reservas</p>
            </SheetHeader>
            <div className="flex flex-col gap-1">
              {selCelda.eventos.map((ev) => (
                <EventoBtn key={ev.key} ev={ev} canchas={canchas} onEvento={(e) => { setSelCelda(null); onEvento(e); }} />
              ))}
            </div>
          </SheetContent>
        )}
      </Sheet>

      <ReprogramarDialog
        id={reprogId}
        open={!!reprogId}
        onOpenChange={(o) => { if (!o) { setReprogId(null); setSelReserva(null); router.refresh(); } }}
      />
    </div>
  );
}

function FilaHora({
  h, dias, porCelda, canchas, onEvento, onMas,
}: {
  h: number; dias: string[]; porCelda: Map<string, EventoCal[]>; canchas: Cancha[]; onEvento: (ev: EventoCal) => void; onMas: (fecha: string, hora: number, eventos: EventoCal[]) => void;
}) {
  return (
    <>
      <div className="border-b border-r bg-neutral-50 p-2 text-right text-xs text-neutral-500">{String(h).padStart(2, '0')}:00</div>
      {dias.map((d) => {
        const evs = porCelda.get(`${d}|${h}`) ?? [];
        const { visibles, ocultos } = dividirCelda(evs, 3);
        return (
          <div key={d} className="min-h-11 border-b border-r p-1">
            <div className="flex flex-col gap-0.5">
              {visibles.map((ev) => (
                <EventoBtn key={ev.key} ev={ev} canchas={canchas} onEvento={onEvento} />
              ))}
              {ocultos.length > 0 && (
                <button
                  onClick={() => onMas(d, h, evs)}
                  className="rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-neutral-500 hover:bg-neutral-100"
                >
                  + {ocultos.length} más
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
