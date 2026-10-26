'use client';
import { useRouter } from 'next/navigation';
import type { GrillaDisponibilidad } from '@/lib/types';
import { hhmmAMin, sumarDias } from '@/lib/hora';
import { nombreCancha } from '@/lib/calendario';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// Franjas del día, en minutos desde la medianoche. Las horas de madrugada (00:00–06:00) cuentan
// como parte de la noche: pertenecen a la jornada que cerró de madrugada.
const FRANJAS: { v: string; l: string; ok: (min: number) => boolean }[] = [
  { v: 'todo', l: 'Todo el día', ok: () => true },
  { v: 'manana', l: 'Mañana', ok: (m) => m >= 360 && m < 780 },
  { v: 'tarde', l: 'Tarde', ok: (m) => m >= 780 && m < 1200 },
  { v: 'noche', l: 'Noche', ok: (m) => m >= 1200 || m < 360 },
];

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function Segmentos({ valor, opciones, onChange }: { valor: string; opciones: { v: string; l: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1">
      {opciones.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${o.v === valor ? 'border-neutral-900 bg-neutral-900 text-white' : 'bg-white hover:bg-neutral-50'}`}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

const diaDe = (f: string) => new Date(f + 'T12:00:00Z').getUTCDay();
const largo = (min: number) => (min === 60 ? '1 h' : min === 90 ? '1½ h' : `${min / 60} h`);

/**
 * "¿Tenés cancha el jueves a la tarde?" en una grilla: canchas × horarios para una fecha, con la
 * franja del día para recortar. Es solo consulta: lo libre sale de la misma grilla que usa la web
 * de reservas, así que ya descuenta reservas, turnos fijos y bloqueos.
 */
export function DisponibilidadDia({ grilla, deporte, fecha, franja, hoy }: {
  grilla: GrillaDisponibilidad; deporte: 'futbol' | 'padel'; fecha: string; franja: string; hoy: string;
}) {
  const router = useRouter();

  function ir(c: { deporte?: string; fecha?: string; franja?: string }) {
    const p = new URLSearchParams({ deporte: c.deporte ?? deporte, fecha: c.fecha ?? fecha, franja: c.franja ?? franja });
    router.replace(`/disponibilidad?${p.toString()}`);
  }

  // Mini calendario de 5 semanas alineado de lunes a domingo, empezando por la semana actual.
  const lunes = sumarDias(hoy, -((diaDe(hoy) + 6) % 7));
  const dias = Array.from({ length: 35 }, (_, i) => sumarDias(lunes, i));
  const f = FRANJAS.find((x) => x.v === franja) ?? FRANJAS[0];
  const horas = grilla.horas.filter((h) => f.ok(hhmmAMin(h)));

  // Cuántas canchas libres hay por hora (para el resumen de la fila).
  const libresEn = (h: string) => grilla.canchas.filter((c) => grilla.libres[c.id]?.[h]).length;

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Disponibilidad</h1>
      <p className="mb-4 text-sm text-neutral-600">Mirá qué canchas están libres un día y una franja, sin armar la reserva.</p>

      <div className="mb-4 grid gap-4 md:grid-cols-[auto_1fr]">
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Deporte</p>
            <Segmentos valor={deporte} opciones={[{ v: 'padel', l: 'Pádel' }, { v: 'futbol', l: 'Fútbol' }]} onChange={(v) => ir({ deporte: v })} />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Franja del día</p>
            <Segmentos valor={franja} opciones={FRANJAS.map((x) => ({ v: x.v, l: x.l }))} onChange={(v) => ir({ franja: v })} />
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Día</p>
          <div className="grid max-w-md grid-cols-7 gap-1">
            {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => <div key={d} className="pb-1 text-center text-xs text-neutral-500">{d}</div>)}
            {dias.map((d) => {
              const pasado = d < hoy;
              const elegido = d === fecha;
              const primero = d.endsWith('-01') || d === dias[0];
              return (
                <button key={d} type="button" disabled={pasado} onClick={() => ir({ fecha: d })}
                  className={`flex h-11 flex-col items-center justify-center rounded-md border text-sm leading-tight ${elegido ? 'border-neutral-900 bg-neutral-900 text-white' : pasado ? 'border-transparent text-neutral-300' : 'bg-white hover:bg-neutral-50'}`}>
                  <span className="font-medium">{Number(d.slice(8, 10))}</span>
                  {(d === hoy || primero) && <span className={`text-[10px] ${elegido ? 'text-neutral-300' : 'text-neutral-500'}`}>{d === hoy ? 'hoy' : MESES[Number(d.slice(5, 7)) - 1]}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <h2 className="mb-2 text-sm font-medium capitalize text-neutral-700">{DIAS[diaDe(fecha)]} {Number(fecha.slice(8, 10))} de {MESES_LARGO[Number(fecha.slice(5, 7)) - 1]} · {f.l.toLowerCase()}</h2>

      {grilla.canchas.length === 0 || horas.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">
          No hay horarios libres para mostrar en esta franja. Probá con otra franja u otro día.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-neutral-50">
                <th className="sticky left-0 bg-neutral-50 px-3 py-2 text-left font-medium">Hora</th>
                {grilla.canchas.map((c) => <th key={c.id} className="px-2 py-2 text-center font-medium">{nombreCancha(c.nombre)}</th>)}
              </tr>
            </thead>
            <tbody>
              {horas.map((h) => (
                <tr key={h} className="border-b last:border-0">
                  <td className="sticky left-0 bg-white px-3 py-1.5 font-medium">{h} <span className="text-xs font-normal text-neutral-500">({libresEn(h)} libres)</span></td>
                  {grilla.canchas.map((c) => {
                    const libre = grilla.libres[c.id]?.[h];
                    const durs = grilla.duraciones[c.id]?.[h] ?? [];
                    const max = durs.length ? Math.max(...durs.map((d) => d.min)) : 0;
                    return (
                      <td key={c.id} className="px-1 py-1">
                        {libre ? (
                          <div className="rounded bg-green-200 px-2 py-1 text-center text-xs font-medium text-green-900"
                            title={durs.map((d) => `${largo(d.min)}: $${d.precio.toLocaleString('es-AR')}`).join(' · ')}>
                            Libre{max > 60 ? ` · hasta ${largo(max)}` : ''}
                          </div>
                        ) : (
                          <div className="rounded bg-neutral-100 px-2 py-1 text-center text-xs text-neutral-400">—</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-neutral-500">Pasá el mouse (o mantené apretado) por una celda libre para ver los precios por duración. Para reservar, usá Nueva reserva en Reservas u Hoy.</p>
    </>
  );
}
