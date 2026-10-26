'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { Cancha, DisponibilidadSemanal } from '@/lib/types';
import { hhmmAMin, hhmmDeMin } from '@/lib/hora';
import { nombreCancha } from '@/lib/calendario';
import { TurnoFijoDialog } from './turno-fijo-dialog';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DURACIONES = [{ v: 60, l: '1 hora' }, { v: 90, l: '1½ horas' }, { v: 120, l: '2 horas' }];

interface Seleccion { canchaId: string; horaInicio: string; horaFin: string; n: number }

/**
 * "¿Tenés cancha los miércoles a tal hora?" en una sola grilla: cancha × horario para un día de la
 * semana. Verde = entra un fijo; ámbar = no hay fijo pero hay reservas sueltas esos días (se
 * listan); gris = ya lo ocupa un fijo o un bloqueo. Tocar una celda libre abre "Nuevo turno fijo"
 * con la cancha, el día y el horario cargados.
 */
export function DisponibilidadSemanalVista({ datos, canchas, deporte, dia, dur }: {
  datos: DisponibilidadSemanal; canchas: Cancha[]; deporte: 'futbol' | 'padel'; dia: number; dur: number;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Seleccion | null>(null);
  const [abierto, setAbierto] = useState(false);

  function ir(cambios: { deporte?: string; dia?: number; dur?: number }) {
    const p = new URLSearchParams({ deporte: cambios.deporte ?? deporte, dia: String(cambios.dia ?? dia), dur: String(cambios.dur ?? dur) });
    router.replace(`/turnos-fijos/disponibilidad?${p.toString()}`);
  }

  function elegir(canchaId: string, hora: string) {
    setSel({ canchaId, horaInicio: hora, horaFin: hhmmDeMin(hhmmAMin(hora) + dur), n: (sel?.n ?? 0) + 1 });
    setAbierto(true);
  }

  const campo = 'rounded-md border bg-white px-2 py-1.5 text-sm';
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link href="/turnos-fijos" className="inline-flex items-center text-sm text-neutral-600 hover:text-neutral-900"><ArrowLeft className="mr-1 h-4 w-4" /> Turnos fijos</Link>
      </div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Disponibilidad semanal</h1>
      <p className="mb-4 text-sm text-neutral-600">Mirá qué horarios entran como turno fijo un día de la semana, sin cargar nada. Tocá un horario libre para crear el fijo.</p>

      <div className="mb-4 flex flex-wrap gap-3">
        <label className="text-sm">Deporte{' '}
          <select value={deporte} onChange={(e) => ir({ deporte: e.target.value })} className={campo}>
            <option value="padel">Pádel</option>
            <option value="futbol">Fútbol</option>
          </select>
        </label>
        <label className="text-sm">Día{' '}
          <select value={dia} onChange={(e) => ir({ dia: Number(e.target.value) })} className={campo}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{DIAS[d]}</option>)}
          </select>
        </label>
        <label className="text-sm">Duración{' '}
          <select value={dur} onChange={(e) => ir({ dur: Number(e.target.value) })} className={campo}>
            {DURACIONES.filter((d) => deporte === 'padel' || d.v === 60).map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
          </select>
        </label>
      </div>

      <div className="mb-3 flex flex-wrap gap-4 text-xs text-neutral-600">
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-green-200 align-middle" />Libre</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-amber-200 align-middle" />Libre, pero hay reservas sueltas esos días</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded bg-neutral-200 align-middle" />Ocupado (fijo o bloqueo)</span>
      </div>

      {datos.canchas.length === 0 || datos.horas.length === 0 ? (
        <p className="rounded-lg border bg-white p-8 text-center text-sm text-neutral-600">No hay canchas u horarios para mostrar.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b bg-neutral-50">
                <th className="sticky left-0 bg-neutral-50 px-3 py-2 text-left font-medium">Hora</th>
                {datos.canchas.map((c) => <th key={c.id} className="px-2 py-2 text-center font-medium">{nombreCancha(c.nombre)}</th>)}
              </tr>
            </thead>
            <tbody>
              {datos.horas.map((h) => (
                <tr key={h} className="border-b last:border-0">
                  <td className="sticky left-0 bg-white px-3 py-1.5 font-medium">{h}</td>
                  {datos.canchas.map((c) => {
                    const celda = datos.celdas[c.id]?.[h];
                    if (!celda) return <td key={c.id} />;
                    if (celda.estado === 'ocupada') {
                      return <td key={c.id} className="px-1 py-1"><div className="rounded bg-neutral-200 px-2 py-1 text-center text-xs text-neutral-600" title={celda.detalle}>{celda.detalle}</div></td>;
                    }
                    const conflicto = celda.estado === 'conflicto';
                    return (
                      <td key={c.id} className="px-1 py-1">
                        <button type="button" onClick={() => elegir(c.id, h)} title={celda.detalle}
                          className={`w-full rounded px-2 py-1 text-center text-xs font-medium ${conflicto ? 'bg-amber-200 text-amber-900 hover:bg-amber-300' : 'bg-green-200 text-green-900 hover:bg-green-300'}`}>
                          {conflicto ? celda.detalle : 'Libre'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-neutral-500">Se revisan las reservas sueltas de las próximas {datos.semanas} semanas.</p>

      <TurnoFijoDialog
        key={sel?.n ?? 0}
        open={abierto}
        onOpenChange={setAbierto}
        canchas={canchas}
        inicial={sel ? { canchaId: sel.canchaId, diaSemana: dia, horaInicio: sel.horaInicio, horaFin: sel.horaFin } : undefined}
      />
    </>
  );
}
