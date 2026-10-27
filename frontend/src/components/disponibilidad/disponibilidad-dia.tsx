'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Search } from 'lucide-react';
import type { Cancha, GrillaDisponibilidad } from '@/lib/types';
import { NuevaReservaDialog } from '@/components/reservas/nueva-reserva-dialog';
import { hhmmAMin, sumarDias } from '@/lib/hora';
import { nombreCancha } from '@/lib/calendario';
import { Button } from '@/components/ui/button';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// Franjas del día, en minutos desde la medianoche. Las horas de madrugada (00:00–06:00) cuentan
// como parte de la noche: pertenecen a la jornada que cerró de madrugada.
const FRANJAS: { v: string; l: string; ok: (min: number) => boolean }[] = [
  { v: 'todo', l: 'Todo el día', ok: () => true },
  { v: 'manana', l: 'Mañana', ok: (m) => m >= 360 && m < 780 },
  { v: 'tarde', l: 'Tarde', ok: (m) => m >= 780 && m < 1200 },
  { v: 'noche', l: 'Noche', ok: (m) => m >= 1200 || m < 360 },
];

const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const diaDe = (f: string) => new Date(f + 'T12:00:00Z').getUTCDay();
const largo = (min: number) => (min === 60 ? '1 h' : min === 90 ? '1½ h' : `${min / 60} h`);
const fechaLarga = (f: string) => `${DIAS[diaDe(f)]} ${Number(f.slice(8, 10))} de ${MESES_LARGO[Number(f.slice(5, 7)) - 1]}`;
const etiquetaDeporte = (d: string) => (d === 'futbol' ? 'Fútbol' : 'Pádel');

function Segmentos({ valor, opciones, onChange }: { valor: string; opciones: { v: string; l: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1">
      {opciones.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)}
          className={`rounded-md border px-4 py-2 text-sm font-medium ${o.v === valor ? 'border-neutral-900 bg-neutral-900 text-white' : 'bg-white hover:bg-neutral-50'}`}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

const Titulo = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <p className="mb-2 text-sm font-medium text-neutral-700"><span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-xs text-white">{n}</span>{children}</p>
);

/**
 * "¿Tenés cancha el jueves a la tarde?" en dos pasos: primero se elige día, deporte y franja y se
 * aprieta Buscar; recién entonces aparece la grilla (con su propio botón para volver a buscar).
 * Es solo consulta: lo libre sale de la misma grilla que usa la web de reservas, así que ya
 * descuenta reservas, turnos fijos y bloqueos.
 */
export function DisponibilidadDia({ grilla, deporte, fecha, franja, hoy, canchas, senaMontoFijo }: {
  grilla: GrillaDisponibilidad | null; deporte: string; fecha: string; franja: string; hoy: string;
  canchas: Cancha[]; senaMontoFijo: number;
}) {
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Disponibilidad</h1>
      <p className="mb-5 text-sm text-neutral-600">Mirá qué canchas están libres un día y una franja, sin armar la reserva.</p>
      {grilla ? <Resultado grilla={grilla} deporte={deporte} fecha={fecha} franja={franja} canchas={canchas} senaMontoFijo={senaMontoFijo} /> : <Formulario hoy={hoy} deporteInicial={deporte} fechaInicial={fecha} franjaInicial={franja} />}
    </>
  );
}

function Formulario({ hoy, deporteInicial, fechaInicial, franjaInicial }: { hoy: string; deporteInicial: string; fechaInicial: string; franjaInicial: string }) {
  const router = useRouter();
  const [fecha, setFecha] = useState(fechaInicial);
  const [deporte, setDeporte] = useState(deporteInicial);
  const [franja, setFranja] = useState(franjaInicial || 'todo');

  // Tira horizontal con las próximas 3 semanas, desde hoy.
  const dias = Array.from({ length: 21 }, (_, i) => sumarDias(hoy, i));
  const listo = !!fecha && !!deporte;

  function buscar() {
    if (!listo) return;
    router.push(`/disponibilidad?${new URLSearchParams({ deporte, fecha, franja }).toString()}`);
  }

  return (
    <div className="space-y-5 rounded-xl border bg-white p-5">
      <div>
        <Titulo n={1}>Elegí el día</Titulo>
        <div className="flex gap-1.5 overflow-x-auto pb-2">
          {dias.map((d) => {
            const elegido = d === fecha;
            const nuevoMes = d.endsWith('-01') || d === dias[0];
            return (
              <button key={d} type="button" onClick={() => setFecha(d)}
                className={`flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-lg border leading-tight ${elegido ? 'border-neutral-900 bg-neutral-900 text-white' : 'bg-white hover:bg-neutral-50'}`}>
                <span className={`text-xs ${elegido ? 'text-neutral-300' : 'text-neutral-500'}`}>{d === hoy ? 'Hoy' : DIAS_CORTO[diaDe(d)]}</span>
                <span className="text-lg font-semibold">{Number(d.slice(8, 10))}</span>
                <span className={`text-[10px] ${elegido ? 'text-neutral-300' : 'text-neutral-500'}`}>{nuevoMes ? MESES[Number(d.slice(5, 7)) - 1] : ' '}</span>
              </button>
            );
          })}
        </div>
        {fecha && <p className="text-sm font-medium capitalize text-neutral-700">{fechaLarga(fecha)}</p>}
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <Titulo n={2}>Deporte</Titulo>
          <Segmentos valor={deporte} opciones={[{ v: 'padel', l: 'Pádel' }, { v: 'futbol', l: 'Fútbol' }]} onChange={setDeporte} />
        </div>
        <div>
          <Titulo n={3}>Franja del día</Titulo>
          <Segmentos valor={franja} opciones={FRANJAS.map((x) => ({ v: x.v, l: x.l }))} onChange={setFranja} />
        </div>
        <Button className="h-10 px-6" disabled={!listo} onClick={buscar}><Search className="mr-1 h-4 w-4" /> Buscar</Button>
      </div>
    </div>
  );
}

function Resultado({ grilla, deporte, fecha, franja, canchas, senaMontoFijo }: { grilla: GrillaDisponibilidad; deporte: string; fecha: string; franja: string; canchas: Cancha[]; senaMontoFijo: number }) {
  const router = useRouter();
  // Horario libre tocado: abre Nueva reserva con cancha, fecha y hora cargadas. `n` reinicia el diálogo en cada toque.
  const [sel, setSel] = useState<{ canchaId: string; horaInicio: string; n: number } | null>(null);
  const [abierto, setAbierto] = useState(false);
  const f = FRANJAS.find((x) => x.v === franja) ?? FRANJAS[0];
  const horas = grilla.horas.filter((h) => f.ok(hhmmAMin(h)));
  // Cuántas canchas libres hay por hora (para el resumen de la fila).
  const libresEn = (h: string) => grilla.canchas.filter((c) => grilla.libres[c.id]?.[h]).length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => router.push('/disponibilidad')}><ArrowLeft className="mr-1 h-4 w-4" /> Nueva búsqueda</Button>
        <p className="text-base font-medium capitalize text-neutral-800">{etiquetaDeporte(deporte)} · {fechaLarga(fecha)} · <span className="normal-case">{f.l.toLowerCase()}</span></p>
      </div>

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
                          <button type="button" onClick={() => { setSel({ canchaId: c.id, horaInicio: h, n: (sel?.n ?? 0) + 1 }); setAbierto(true); }}
                            className="w-full rounded bg-green-200 px-2 py-1 text-center text-xs font-medium text-green-900 hover:bg-green-300"
                            title={durs.map((d) => `${largo(d.min)}: $${d.precio.toLocaleString('es-AR')}`).join(' · ')}>
                            Libre{max > 60 ? ` · hasta ${largo(max)}` : ''}
                          </button>
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
      <p className="mt-3 text-xs text-neutral-500">Tocá un horario libre para reservarlo. Pasá el mouse por encima para ver los precios por duración.</p>

      {sel && (
        <NuevaReservaDialog key={sel.n} canchas={canchas} senaMontoFijo={senaMontoFijo}
          controlado={{ open: abierto, onOpenChange: setAbierto }}
          inicial={{ canchaId: sel.canchaId, fecha, horaInicio: sel.horaInicio }} />
      )}
    </>
  );
}
