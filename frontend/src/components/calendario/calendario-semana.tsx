'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { Reserva, Cancha, TurnoFijo, Bloqueo } from '@/lib/types';
import { colorDeCancha, ubicarEnTz, horasDelDia, materializar, etiquetaMotivo, ESTILO_TIPO, hhmmDeMinutos, horasQueToca, type EventoCal } from '@/lib/calendario';
import { ReprogramarDialog } from '@/components/reservas/reprogramar-dialog';
import { AccionReservaSheet } from '@/components/reservas/accion-reserva-sheet';
import { EditarReservaDialog } from '@/components/reservas/editar-reserva-dialog';

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
  const enPunto = ev.horaTexto === `${String(ev.horaNum).padStart(2, '0')}:00`;
  const hora = enPunto && !ev.esContinuacion ? '' : `${ev.horaTexto} · `;
  const dur = ev.duracionMin === 60 ? '' : `${ev.horaTexto}–${ev.finTexto} · `;
  const cuerpo = `${dur || hora}${ev.subtitulo || ev.titulo}`;
  const cuerpoTitle = `${ev.horaTexto} · ${ev.titulo}${ev.subtitulo ? ' · ' + ev.subtitulo : ''}`;
  return (
    <button
      onClick={() => onEvento(ev)}
      className={`block w-full truncate rounded border px-1.5 py-0.5 text-left text-[12px] leading-tight ${clasesColor} ${esReserva ? '' : 'border-dashed'} ${ev.esContinuacion ? 'opacity-50' : esperando ? 'opacity-60' : ''}`}
      title={`${cuerpoTitle}${tag ? ' · ' + tag : ''}${esperando ? ' (seña)' : ''}`}
    >
      {ev.esContinuacion && <span className="opacity-60">↳ </span>}
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
  const [editandoRes, setEditandoRes] = useState<Reserva | null>(null);
  const [selInfo, setSelInfo] = useState<EventoCal | null>(null);
  const [reprogId, setReprogId] = useState<string | null>(null);

  // Mobile day view state
  const [diaSel, setDiaSel] = useState(dias.includes(hoy) ? hoy : dias[0]);

  const horas = horasDelDia(horaApertura, horaCierre);
  const reservasById = new Map(reservas.map((r) => [r.id, r]));

  // Lista unificada de eventos (reservas no canceladas + fijos/bloqueos materializados)
  const eventos: EventoCal[] = [];
  const matPorDia = new Map<string, Set<string>>();
  for (const r of reservas) {
    if (r.estado === 'CANCELADA') continue;
    const { fecha, horaNum, minuto } = ubicarEnTz(r.fechaInicio, horaApertura);
    if (r.turnoFijoId) {
      const ids = matPorDia.get(fecha) ?? new Set<string>();
      ids.add(r.turnoFijoId);
      matPorDia.set(fecha, ids);
    }
    const iniMin = horaNum * 60 + minuto;
    // Si fechaFin faltara o viniera corrupta, duracionMin da NaN y la reserva no se
    // dibujaría en ninguna celda — la peor falla posible: una cancha ocupada que se ve libre.
    const d = Math.round((new Date(r.fechaFin).getTime() - new Date(r.fechaInicio).getTime()) / 60000);
    const duracionMin = Number.isFinite(d) && d > 0 ? d : 60;
    const finMin = iniMin + duracionMin;
    // Una reserva de 18:30 a 20:00 se dibuja en las celdas de 18 y de 19: si solo apareciera
    // en la primera, la de las 19 se vería libre cuando no lo está.
    const horasTurno = horasQueToca(iniMin, finMin);
    horasTurno.forEach((h, i) => {
      eventos.push({
        key: `r${r.id}-${h}`, tipo: 'reserva', fecha, horaNum: h,
        horaTexto: hhmmDeMinutos(iniMin), finTexto: hhmmDeMinutos(finMin), duracionMin,
        esContinuacion: i > 0,
        canchaId: r.cancha?.id ?? '', titulo: r.cancha?.nombre ?? '',
        subtitulo: r.cliente?.nombre ?? '', estado: r.estado, refId: r.id,
      });
    });
  }
  eventos.push(...materializar(dias, fijos, bloqueos, matPorDia, horaApertura));

  const porCelda = new Map<string, EventoCal[]>();
  for (const ev of eventos) {
    const k = `${ev.fecha}|${ev.horaNum}`;
    const arr = porCelda.get(k) ?? [];
    arr.push(ev);
    porCelda.set(k, arr);
  }
  // Las reservas se insertan ordenadas por hora de inicio, así que en una celda, las
  // continuaciones de turnos anteriores entran antes que los que arrancan en esa hora.
  // Se muestran todos los turnos de la celda (la fila crece): ninguno queda escondido detrás de un "+N más".
  // Los que arrancan en esa hora van primero.
  for (const arr of porCelda.values()) {
    arr.sort((a, b) =>
      Number(a.esContinuacion) - Number(b.esContinuacion) || a.horaTexto.localeCompare(b.horaTexto));
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
            <FilaHora key={h} h={Number(h.slice(0, 2))} dias={dias} porCelda={porCelda} canchas={canchas} onEvento={onEvento} />
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
            const hn = Number(h.slice(0, 2));
            const evs = porCelda.get(`${diaSel}|${hn}`) ?? [];
            return (
              <div key={h} className="flex min-h-12 border-b last:border-b-0">
                {/* Etiqueta de hora */}
                <div className="w-14 shrink-0 border-r bg-neutral-50 p-2 text-right text-xs text-neutral-500 pt-3">
                  {h}
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
        onEditar={(r) => setEditandoRes(r)}
      />
      {editandoRes && <EditarReservaDialog key={editandoRes.id} reserva={editandoRes} open onOpenChange={(o) => { if (!o) { setEditandoRes(null); setSelReserva(null); router.refresh(); } }} />}

      {/* Hoja de info de turno fijo / bloqueo (solo lectura) */}
      <Sheet open={!!selInfo} onOpenChange={(o) => { if (!o) setSelInfo(null); }}>
        {selInfo && (
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{selInfo.tipo === 'fijo' ? 'Turno fijo' : 'Bloqueo'}</SheetTitle>
              <p className="text-sm text-neutral-600">
                {selInfo.titulo} · {selInfo.horaTexto} a {selInfo.finTexto}
              </p>
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

      <ReprogramarDialog
        id={reprogId}
        open={!!reprogId}
        onOpenChange={(o) => { if (!o) { setReprogId(null); setSelReserva(null); router.refresh(); } }}
      />
    </div>
  );
}

function FilaHora({
  h, dias, porCelda, canchas, onEvento,
}: {
  h: number; dias: string[]; porCelda: Map<string, EventoCal[]>; canchas: Cancha[]; onEvento: (ev: EventoCal) => void;
}) {
  return (
    <>
      <div className="border-b border-r bg-neutral-50 p-2 text-right text-xs text-neutral-500">{String(h).padStart(2, '0')}:00</div>
      {dias.map((d) => {
        const evs = porCelda.get(`${d}|${h}`) ?? [];
        return (
          <div key={d} className="min-h-11 border-b border-r p-1">
            <div className="flex flex-col gap-0.5">
              {evs.map((ev) => (
                <EventoBtn key={ev.key} ev={ev} canchas={canchas} onEvento={onEvento} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
