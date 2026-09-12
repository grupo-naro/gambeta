import { getEnv } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { canchaRepo } from '../../repositories/cancha.repo.js';
import { configService } from '../config.service.js';
import { dayWindowUtc, jornadaWindowUtc, hhmmAMin, minutoDeJornada, hhmmDeMin, dayOfWeekInTz, sumarDias } from '../../utils/tz.js';
import type { ReservaCelda } from './grilla.js';
import { expandirSemana, type FijoInput, type BloqueoInput } from './expandir.js';

const TZ = () => getEnv().TZ_NEGOCIO;
const DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'];

function ymd(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export function ymdEnTz(d: Date): string {
  return ymd(d);
}

function partesEnTz(iso: Date, apertura: string): { fecha: string; hora: string } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(iso);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  let h = g('hour'); if (h === '24') h = '00';
  const hora = `${h}:${g('minute')}`;
  let fecha = `${g('year')}-${g('month')}-${g('day')}`;
  // Si la hora calendario es anterior a la apertura, el instante pertenece a la JORNADA del día
  // anterior, no al día calendario en el que cae — mismo criterio que ubicarEnTz del frontend
  // (Tarea 12) y reserva.service.list (Tarea 11). Sin esto, una reserva de las 00:00 (guardada
  // con el instante del día siguiente) aparecía "adelantada" un día respecto del turno fijo
  // equivalente, que expandirSemana ubica por diaSemana (=jornada).
  if (hhmmAMin(hora) < hhmmAMin(apertura)) {
    fecha = sumarDias(fecha, -1);
  }
  return { fecha, hora };
}

export function diasSemanaActual(): { dia: string; fecha: string }[] {
  const hoy = ymd(new Date());
  const [y, m, d] = hoy.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const lunesMs = base.getTime() - ((base.getUTCDay() + 6) % 7) * 86400000;
  return DIAS.map((dia, i) => ({ dia, fecha: new Date(lunesMs + i * 86400000).toISOString().slice(0, 10) }));
}

export function horasDeConfig(horaApertura: string, horaCierre: string): string[] {
  const out: string[] = [];
  const fin = minutoDeJornada(horaCierre, horaApertura);
  for (let m = hhmmAMin(horaApertura); m + 60 <= fin; m += 60) out.push(hhmmDeMin(m));
  return out;
}

export async function dataSemana() {
  const dias = diasSemanaActual();
  const cfg = await configService.get();
  const aperturaU = hhmmAMin(cfg.horaApertura) <= hhmmAMin(cfg.horaAperturaFinde) ? cfg.horaApertura : cfg.horaAperturaFinde;
  const cierreU = minutoDeJornada(cfg.horaCierre, aperturaU) >= minutoDeJornada(cfg.horaCierreFinde, aperturaU) ? cfg.horaCierre : cfg.horaCierreFinde;
  const horas = horasDeConfig(aperturaU, cierreU);
  const canchas = (await canchaRepo.list(true)).map((c) => ({ id: c.id, nombre: c.nombre }));
  const start = dayWindowUtc(dias[0].fecha, TZ()).start;
  // El último día de la semana puede tener una jornada que cruza la medianoche: su turno de las
  // 00:00 se guarda con el instante real del día calendario SIGUIENTE, justo en el borde de
  // dayWindowUtc(dias[6]).end (la medianoche de ese día siguiente). Con `lt: end` sobre esa
  // ventana de día calendario, ese turno quedaba afuera de la semana a la que pertenece. Mismo
  // criterio que reserva.service.list (Tarea 11): la ventana real es la de la JORNADA de
  // dias[6], no la de su día calendario.
  const dowUltimo = dayOfWeekInTz(dias[6].fecha, TZ());
  const esFindeUltimo = dowUltimo === 0 || dowUltimo === 6;
  const end = jornadaWindowUtc(
    dias[6].fecha, TZ(),
    esFindeUltimo ? cfg.horaAperturaFinde : cfg.horaApertura,
    esFindeUltimo ? cfg.horaCierreFinde : cfg.horaCierre,
  ).end;

  const reservasDb = await prisma.reserva.findMany({
    where: { fechaInicio: { gte: start, lt: end }, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA', 'COMPLETADA'] } },
    include: { cliente: { select: { nombre: true } }, cobros: { select: { monto: true } } },
  });
  const reservas: ReservaCelda[] = reservasDb.map((r) => {
    const { fecha, hora } = partesEnTz(r.fechaInicio, aperturaU);
    return {
      canchaId: r.canchaId, fecha, hora, cliente: r.cliente?.nombre ?? '-',
      monto: Number(r.monto), pagado: r.cobros.reduce((s, c) => s + Number(c.monto), 0),
      tipo: r.turnoFijoId ? 'fijo' : 'suelto',
    };
  });

  const fijosDb = await prisma.turnoFijo.findMany({ where: { activo: true }, include: { excepciones: true } });
  const fijos: FijoInput[] = fijosDb.map((f) => ({
    canchaId: f.canchaId, clienteNombre: f.clienteNombre, diaSemana: f.diaSemana,
    horaInicio: f.horaInicio, horaFin: f.horaFin,
    precio: f.precio == null ? null : Number(f.precio),
    excepciones: f.excepciones.map((e) => e.fecha.toISOString().slice(0, 10)),
  }));

  const bloqueosDb = await prisma.bloqueo.findMany({ where: { activo: true }, include: { excepciones: true } });
  const bloqueos: BloqueoInput[] = bloqueosDb.map((b) => ({
    canchaId: b.canchaId, motivo: b.motivo, recurrente: b.recurrente, diaSemana: b.diaSemana,
    fecha: b.fecha ? b.fecha.toISOString().slice(0, 10) : null,
    horaInicio: b.horaInicio, horaFin: b.horaFin, nota: b.nota,
    excepciones: b.excepciones.map((e) => e.fecha.toISOString().slice(0, 10)),
  }));

  const celdas = expandirSemana({ reservas, fijos, bloqueos }, dias, horas, TZ());
  return { dias, horas, canchas, celdas };
}
