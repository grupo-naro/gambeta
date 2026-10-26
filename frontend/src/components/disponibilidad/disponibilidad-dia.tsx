'use client';
import { useRouter } from 'next/navigation';
import type { GrillaDisponibilidad } from '@/lib/types';
import { hhmmAMin, sumarDias } from '@/lib/hora';
import { nombreCancha } from '@/lib/calendario';

const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// Franjas del día, en minutos desde la medianoche. Las horas de madrugada (00:00–06:00) cuentan
// como parte de la noche: pertenecen a la jornada que cerró de madrugada.
const FRANJAS: { v: string; l: string; ok: (min: number) => boolean }[] = [
  { v: 'todo', l: 'Todo el día', ok: () => true },
  { v: 'manana', l: 'Mañana', ok: (m) => m >= 360 && m < 780 },
  { v: 'tarde', l: 'Tarde', ok: (m) => m >= 780 && m < 1200 },
  { v: 'noche', l: 'Noche', ok: (m) => m >= 1200 || m < 360 },
];

const diaDe = (f: string) => new Date(f + 'T12:00:00Z').getUTCDay();
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
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

  // Los próximos 14 días como atajos: "jueves" suele ser "el jueves que viene".
  const atajos = Array.from({ length: 14 }, (_, i) => sumarDias(hoy, i));
  const f = FRANJAS.find((x) => x.v === franja) ?? FRANJAS[0];
  const horas = grilla.horas.filter((h) => f.ok(hhmmAMin(h)));
  const campo = 'rounded-md border bg-white px-2 py-1.5 text-sm';

  // Cuántas canchas libres hay por hora (para el resumen de la fila).
  const libresEn = (h: string) => grilla.canchas.filter((c) => grilla.libres[c.id]?.[h]).length;

  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Disponibilidad</h1>
      <p className="mb-4 text-sm text-neutral-600">Mirá qué canchas están libres un día y una franja, sin armar la reserva.</p>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">Deporte{' '}
          <select value={deporte} onChange={(e) => ir({ deporte: e.target.value })} className={campo}>
            <option value="padel">Pádel</option>
            <option value="futbol">Fútbol</option>
          </select>
        </label>
        <label className="text-sm">Fecha{' '}
          <input type="date" value={fecha} min={hoy} onChange={(e) => e.target.value && ir({ fecha: e.target.value })} className={campo} />
        </label>
        <label className="text-sm">Franja{' '}
          <select value={franja} onChange={(e) => ir({ franja: e.target.value })} className={campo}>
            {FRANJAS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
          </select>
        </label>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {atajos.map((d) => (
          <button key={d} type="button" onClick={() => ir({ fecha: d })}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${d === fecha ? 'border-neutral-900 bg-neutral-900 text-white' : 'bg-white hover:bg-neutral-50'}`}>
            {d === hoy ? 'Hoy' : `${DIAS_CORTO[diaDe(d)]} ${ddmm(d)}`}
          </button>
        ))}
      </div>

      <h2 className="mb-2 text-sm font-medium capitalize text-neutral-700">{DIAS[diaDe(fecha)]} {ddmm(fecha)} · {f.l.toLowerCase()}</h2>

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
