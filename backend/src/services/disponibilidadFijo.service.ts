import { getEnv } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { canchaRepo } from '../repositories/cancha.repo.js';
import { configService } from './config.service.js';
import { dayOfWeekInTz, hhmmAMin, hhmmDeMin, hoyEnTz, minutoDeJornada, sumarDias } from '../utils/tz.js';

/**
 * ¿Está libre un horario SEMANAL? Responde "¿tenés cancha los miércoles a tal hora?" sin cargar
 * un turno fijo de prueba. Para cada cancha y horario de un día de la semana dice si un fijo de
 * `duracionMin` entraría:
 *  - `ocupada`: ya lo toma un turno fijo o un bloqueo recurrente (mismo criterio que al crear un fijo);
 *  - `conflicto`: no hay fijo/bloqueo, pero hay reservas sueltas ese día de la semana en las
 *    próximas `semanas` (se devuelven las fechas): fijarlo ahí dejaría esas reservas pisadas;
 *  - `libre`: ninguna de las anteriores.
 * Las canchas que comparten sector (una entera y sus partes) se pisan entre sí.
 */
export type EstadoCelda = 'libre' | 'ocupada' | 'conflicto';
export interface CeldaDisponibilidad { estado: EstadoCelda; detalle?: string; fechas?: string[] }
export interface DisponibilidadSemanal {
  deporte: 'futbol' | 'padel';
  diaSemana: number;
  duracionMin: number;
  semanas: number;
  horas: string[];
  canchas: { id: string; nombre: string }[];
  celdas: Record<string, Record<string, CeldaDisponibilidad>>;
}

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

export const disponibilidadFijoService = {
  async semanal(deporte: 'futbol' | 'padel', diaSemana: number, duracionMin: number, semanas: number): Promise<DisponibilidadSemanal> {
    const tz = getEnv().TZ_NEGOCIO;
    const cfg = await configService.get();
    const finde = diaSemana === 0 || diaSemana === 6;
    const apertura = finde ? cfg.horaAperturaFinde : cfg.horaApertura;
    const cierreM = minutoDeJornada(finde ? cfg.horaCierreFinde : cfg.horaCierre, apertura);
    const hoy = hoyEnTz(tz);

    const canchas = (await canchaRepo.list(true)).filter((c) =>
      deporte === 'futbol' ? c.tipo.toLowerCase().startsWith('futbol') : c.tipo.toLowerCase() === 'padel');

    // Sectores: una cancha se pisa con toda otra que comparta alguno (la entera y sus partes).
    const cs = await prisma.canchaSector.findMany({ select: { canchaId: true, sectorId: true } });
    const sectoresDe = new Map<string, Set<string>>();
    for (const r of cs) {
      if (!sectoresDe.has(r.canchaId)) sectoresDe.set(r.canchaId, new Set());
      sectoresDe.get(r.canchaId)!.add(r.sectorId);
    }
    const relacionadas = (canchaId: string) => {
      const mios = sectoresDe.get(canchaId) ?? new Set<string>();
      const out = new Set<string>([canchaId]);
      for (const [otra, sec] of sectoresDe) if ([...sec].some((s) => mios.has(s))) out.add(otra);
      return out;
    };

    // Fijos y bloqueos recurrentes de ese día que todavía rigen (un período ya vencido no ocupa).
    const fijos = (await prisma.turnoFijo.findMany({ where: { activo: true, diaSemana } }))
      .filter((f) => !f.vigenciaHasta || ymd(f.vigenciaHasta)! >= hoy);
    const bloqueos = (await prisma.bloqueo.findMany({ where: { activo: true, recurrente: true, diaSemana } }))
      .filter((b) => !b.vigenciaHasta || ymd(b.vigenciaHasta)! >= hoy);

    // Reservas sueltas de ese día de la semana dentro del horizonte (las de un fijo ya cuentan por el fijo).
    const sectorIds = [...new Set(cs.map((r) => r.sectorId))];
    const ahora = new Date();
    const reservas = await prisma.reservaSector.findMany({
      where: { sectorId: { in: sectorIds }, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA'] }, fechaInicio: { gte: ahora, lt: new Date(ahora.getTime() + semanas * 7 * 86400000) } },
      select: { sectorId: true, fechaInicio: true, fechaFin: true, reserva: { select: { turnoFijoId: true } } },
    });
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const ocupadas: { sectorId: string; fecha: string; ini: number; fin: number }[] = [];
    for (const r of reservas) {
      if (r.reserva.turnoFijoId) continue;
      const p = Object.fromEntries(fmt.formatToParts(r.fechaInicio).map((x) => [x.type, x.value]));
      const min = (p.hour === '24' ? 0 : Number(p.hour)) * 60 + Number(p.minute);
      const fCal = `${p.year}-${p.month}-${p.day}`;
      // Misma regla de jornada de todo el sistema: antes de la apertura pertenece al día anterior.
      const dia0 = dayOfWeekInTz(fCal, tz);
      const aper = dia0 === 0 || dia0 === 6 ? cfg.horaAperturaFinde : cfg.horaApertura;
      const antes = min < hhmmAMin(aper);
      const fecha = antes ? sumarDias(fCal, -1) : fCal;
      if (dayOfWeekInTz(fecha, tz) !== diaSemana) continue;
      const ini = antes ? min + 1440 : min;
      ocupadas.push({ sectorId: r.sectorId, fecha, ini, fin: ini + Math.round((r.fechaFin.getTime() - r.fechaInicio.getTime()) / 60000) });
    }

    const horas: number[] = [];
    for (let m = hhmmAMin(apertura); m + duracionMin <= cierreM; m += 30) horas.push(m);

    const celdas: DisponibilidadSemanal['celdas'] = {};
    for (const c of canchas) {
      const rel = relacionadas(c.id);
      const misSectores = sectoresDe.get(c.id) ?? new Set<string>();
      celdas[c.id] = {};
      for (const m of horas) {
        const fin = m + duracionMin;
        const choca = (hi: string, hf: string) => minutoDeJornada(hi, apertura) < fin && m < minutoDeJornada(hf, apertura);
        const f = fijos.find((x) => rel.has(x.canchaId) && choca(x.horaInicio, x.horaFin));
        const b = bloqueos.find((x) => rel.has(x.canchaId) && choca(x.horaInicio, x.horaFin));
        let celda: CeldaDisponibilidad;
        if (f) {
          const hasta = ymd(f.vigenciaHasta);
          celda = { estado: 'ocupada', detalle: `Fijo de ${f.clienteNombre}${hasta ? ` (hasta el ${dm(hasta)})` : ''}` };
        } else if (b) {
          const hasta = ymd(b.vigenciaHasta);
          celda = { estado: 'ocupada', detalle: `Bloqueo (${b.motivo.toLowerCase()})${hasta ? ` hasta el ${dm(hasta)}` : ''}` };
        } else {
          const fechas = [...new Set(ocupadas.filter((o) => misSectores.has(o.sectorId) && o.ini < fin && m < o.fin).map((o) => o.fecha))].sort();
          celda = fechas.length
            ? { estado: 'conflicto', fechas, detalle: `Reservas sueltas: ${fechas.slice(0, 4).map(dm).join(', ')}${fechas.length > 4 ? '…' : ''}` }
            : { estado: 'libre' };
        }
        celdas[c.id][hhmmDeMin(m)] = celda;
      }
    }
    return { deporte, diaSemana, duracionMin, semanas, horas: horas.map(hhmmDeMin), canchas: canchas.map((c) => ({ id: c.id, nombre: c.nombre })), celdas };
  },
};
