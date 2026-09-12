import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';
import { dayOfWeekInTz, hhmmAMin, minutoDeJornada } from '../utils/tz.js';
import { configService } from './config.service.js';

// minutos AR (diaSemana + minuto del día) de un timestamp.
function partesAr(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  const min = (p.hour === '24' ? 0 : Number(p.hour)) * 60 + Number(p.minute);
  return { dia, min };
}

// El minuto de jornada de un instante: si cae antes de la apertura, pertenece a la jornada
// anterior y suma 1440. Es la misma regla que `minutoDeJornada`, aplicada a un timestamp.
const minJornada = (p: { min: number }, apertura: string) =>
  p.min < hhmmAMin(apertura) ? p.min + 1440 : p.min;

export interface RangoOcupado { ini: number; fin: number; tipo: 'fijo' | 'bloqueo' }

export const ocupacionService = {
  // canchas que comparten algún sector con la dada (incluye la misma).
  async canchasRelacionadas(canchaId: string): Promise<string[]> {
    const cs = await prisma.canchaSector.findMany({ where: { canchaId }, select: { sectorId: true } });
    const sectorIds = cs.map((s) => s.sectorId);
    if (sectorIds.length === 0) return [canchaId];
    const rel = await prisma.canchaSector.findMany({ where: { sectorId: { in: sectorIds } }, select: { canchaId: true } });
    return [...new Set(rel.map((r) => r.canchaId))];
  },

  // rangos [ini,fin) (minutos) ocupados por fijos/bloqueos para esa cancha en esa fecha.
  async rangosPlantilla(canchaId: string, fecha: string): Promise<RangoOcupado[]> {
    const tz = getEnv().TZ_NEGOCIO;
    const dia = dayOfWeekInTz(fecha, tz);
    const cfg = await configService.get();
    const esFinde = dia === 0 || dia === 6;
    const apertura = esFinde ? cfg.horaAperturaFinde : cfg.horaApertura;
    const canchas = await ocupacionService.canchasRelacionadas(canchaId);
    const fechaDate = new Date(fecha + 'T00:00:00.000Z');
    const out: RangoOcupado[] = [];

    const fijos = await prisma.turnoFijo.findMany({
      where: { canchaId: { in: canchas }, activo: true, diaSemana: dia },
      include: { excepciones: { where: { fecha: fechaDate } } },
    });
    for (const f of fijos) if (f.excepciones.length === 0) out.push({ ini: minutoDeJornada(f.horaInicio, apertura), fin: minutoDeJornada(f.horaFin, apertura), tipo: 'fijo' });

    const bloqueos = await prisma.bloqueo.findMany({
      where: { canchaId: { in: canchas }, activo: true, OR: [{ recurrente: true, diaSemana: dia }, { recurrente: false, fecha: fechaDate }] },
      include: { excepciones: { where: { fecha: fechaDate } } },
    });
    for (const b of bloqueos) if (b.excepciones.length === 0) out.push({ ini: minutoDeJornada(b.horaInicio, apertura), fin: minutoDeJornada(b.horaFin, apertura), tipo: 'bloqueo' });
    return out;
  },

  // ¿[iniMin,finMin) choca con un fijo/bloqueo en esa fecha? devuelve el tipo o null.
  async conflictoReserva(canchaId: string, fecha: string, iniMin: number, finMin: number): Promise<'fijo' | 'bloqueo' | null> {
    const rangos = await ocupacionService.rangosPlantilla(canchaId, fecha);
    const r = rangos.find((x) => x.ini < finMin && iniMin < x.fin);
    return r ? r.tipo : null;
  },

  // Para crear un fijo/bloqueo: ¿pisa un alquiler futuro activo o un fijo/bloqueo existente?
  // match: recurrente => por diaSemana; puntual => por fecha exacta.
  async conflictoAlCrear(canchaId: string, opts: { diaSemana?: number; fecha?: string }, iniMin: number, finMin: number): Promise<boolean> {
    const tz = getEnv().TZ_NEGOCIO;
    const cfg = await configService.get();
    const canchas = await ocupacionService.canchasRelacionadas(canchaId);
    // 1) contra otros fijos/bloqueos (mismo día o misma fecha)
    if (opts.fecha != null) {
      const rangos = await ocupacionService.rangosPlantilla(canchaId, opts.fecha);
      if (rangos.some((x) => x.ini < finMin && iniMin < x.fin)) return true;
    } else if (opts.diaSemana != null) {
      const esFinde = opts.diaSemana === 0 || opts.diaSemana === 6;
      const apertura = esFinde ? cfg.horaAperturaFinde : cfg.horaApertura;
      const fijos = await prisma.turnoFijo.findMany({ where: { canchaId: { in: canchas }, activo: true, diaSemana: opts.diaSemana }, select: { horaInicio: true, horaFin: true } });
      const bloqs = await prisma.bloqueo.findMany({ where: { canchaId: { in: canchas }, activo: true, recurrente: true, diaSemana: opts.diaSemana }, select: { horaInicio: true, horaFin: true } });
      const tpl = [...fijos, ...bloqs];
      if (tpl.some((x) => minutoDeJornada(x.horaInicio, apertura) < finMin && iniMin < minutoDeJornada(x.horaFin, apertura))) return true;
    }
    // 2) contra alquileres futuros activos en los sectores
    const sectores = (await prisma.canchaSector.findMany({ where: { canchaId: { in: canchas } }, select: { sectorId: true } })).map((s) => s.sectorId);
    const alquileres = await prisma.reservaSector.findMany({
      where: { sectorId: { in: sectores }, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA'] }, fechaInicio: { gte: new Date(), lt: new Date(Date.now() + 180 * 86400000) } },
      select: { fechaInicio: true, fechaFin: true },
    });
    const fechaTarget = opts.fecha; // YYYY-MM-DD si puntual
    for (const a of alquileres) {
      const pi = partesAr(a.fechaInicio, tz); const pf = partesAr(a.fechaFin, tz);
      const matchDia = opts.diaSemana != null ? pi.dia === opts.diaSemana : true;
      // para puntual: comparar la fecha AR del alquiler
      let matchFecha = true;
      if (fechaTarget) {
        const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(a.fechaInicio);
        matchFecha = f === fechaTarget;
      }
      // Una reserva que termina exactamente a medianoche cae en el día SIGUIENTE, así que su
      // minuto AR es 0 y la comparación `iniMin < 0` nunca se cumplía: esa reserva quedaba
      // invisible y el admin podía bloquear una cancha ya reservada sin ningún aviso. La
      // exclusion constraint no lo frena, porque fijos y bloqueos no son filas de ReservaSector.
      // Leerlo relativo a la apertura de la jornada de `pi` lo arregla: el minuto de un instante
      // se interpreta con la misma regla que `minutoDeJornada`, no como día calendario.
      const esFindePi = pi.dia === 0 || pi.dia === 6;
      const apertura = esFindePi ? cfg.horaAperturaFinde : cfg.horaApertura;
      const iniAr = minJornada(pi, apertura);
      const finAr = pf.dia !== pi.dia ? pf.min + 1440 : minJornada(pf, apertura);
      const overlap = iniAr < finMin && iniMin < finAr;
      if (matchDia && matchFecha && overlap) return true;
    }
    return false;
  },
};
