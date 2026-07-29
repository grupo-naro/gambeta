import { getEnv } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { canchaService } from './cancha.service.js';
import { configService } from './config.service.js';
import { combineDateTimeUtc, dayWindowUtc, cierreMin, dayOfWeekInTz } from '../utils/tz.js';
import { ocupacionService } from './ocupacion.service.js';
import { canchaRepo } from '../repositories/cancha.repo.js';
import { precioEfectivo } from './precio.service.js';

const SLOT_MIN = 60;
const pad = (n: number) => String(n).padStart(2, '0');
const toHHMM = (mins: number) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
const fromHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

function horarioDe(fecha: string, tz: string, cfg: { horaApertura: string; horaCierre: string; horaAperturaFinde: string; horaCierreFinde: string }) {
  const dow = dayOfWeekInTz(fecha, tz); // 0=domingo .. 6=sábado
  const finde = dow === 0 || dow === 6;
  return finde
    ? { apertura: cfg.horaAperturaFinde, cierre: cfg.horaCierreFinde }
    : { apertura: cfg.horaApertura, cierre: cfg.horaCierre };
}

export interface Slot { horaInicio: string; horaFin: string; inicioUtc: string; finUtc: string; }

export const disponibilidadService = {
  async listar(canchaId: string, fecha: string): Promise<{ canchaId: string; fecha: string; slots: Slot[] }> {
    await canchaService.get(canchaId);
    const tz = getEnv().TZ_NEGOCIO;
    const cfg = await configService.get();
    const { start, end } = dayWindowUtc(fecha, tz);

    const sectores = await prisma.canchaSector.findMany({ where: { canchaId }, select: { sectorId: true } });
    const sectorIds = sectores.map((s) => s.sectorId);
    const ocup = await prisma.reservaSector.findMany({
      where: { sectorId: { in: sectorIds }, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA'] }, fechaInicio: { gte: start, lt: end } },
      select: { fechaInicio: true, fechaFin: true },
    });

    const plantillas = await ocupacionService.rangosPlantilla(canchaId, fecha);

    const slots: Slot[] = [];
    const { apertura, cierre } = horarioDe(fecha, tz, cfg);
    for (let t = fromHHMM(apertura); t + SLOT_MIN <= cierreMin(cierre); t += SLOT_MIN) {
      const horaInicio = toHHMM(t);
      const horaFin = toHHMM(t + SLOT_MIN);
      const inicioUtc = combineDateTimeUtc(fecha, horaInicio, tz);
      const finUtc = combineDateTimeUtc(fecha, horaFin, tz);
      const minIni = fromHHMM(horaInicio); const minFin = fromHHMM(horaFin);
      const taken = ocup.some((r) => r.fechaInicio < finUtc && inicioUtc < r.fechaFin)
        || plantillas.some((p) => p.ini < minFin && minIni < p.fin);
      if (!taken) slots.push({ horaInicio, horaFin, inicioUtc: inicioUtc.toISOString(), finUtc: finUtc.toISOString() });
    }
    return { canchaId, fecha, slots };
  },

  async listarPorTamano(jugadores: number, fecha: string): Promise<{ jugadores: number; fecha: string; slots: { horaInicio: string; horaFin: string; canchas: { id: string; nombre: string }[] }[] }> {
    const canchas = await prisma.cancha.findMany({ where: { activa: true, jugadores }, orderBy: { nombre: 'asc' } });
    const byHora = new Map<string, { horaInicio: string; horaFin: string; canchas: { id: string; nombre: string }[] }>();
    // Sequential: each listar fires ~3 DB queries; fine for the typical court count (<10). Parallelize if it grows.
    for (const c of canchas) {
      const { slots } = await this.listar(c.id, fecha);
      for (const s of slots) {
        const e = byHora.get(s.horaInicio) ?? { horaInicio: s.horaInicio, horaFin: s.horaFin, canchas: [] };
        e.canchas.push({ id: c.id, nombre: c.nombre });
        byHora.set(s.horaInicio, e);
      }
    }
    const slots = [...byHora.values()].sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
    return { jugadores, fecha, slots };
  },

  async grilla(deporte: 'futbol' | 'padel', fecha: string): Promise<{
    deporte: string; fecha: string;
    canchas: { id: string; nombre: string; precioHora: number }[];
    horas: string[];
    libres: Record<string, Record<string, boolean>>;
    precios: Record<string, Record<string, number>>;
  }> {
    const todas = await canchaRepo.list(true);
    const canchas = todas.filter((c) =>
      deporte === 'futbol' ? c.tipo.toLowerCase().startsWith('futbol') : c.tipo.toLowerCase() === 'padel',
    );
    const cfg = await configService.get();
    const perCancha: { id: string; nombre: string; precioHora: number; precioHoraPico: number; free: Set<string> }[] = [];
    const horasSet = new Set<string>();
    for (const c of canchas) {
      const { slots } = await this.listar(c.id, fecha);
      const futuros = slots.filter((s) => new Date(s.inicioUtc).getTime() > Date.now());
      const free = new Set(futuros.map((s) => s.horaInicio));
      perCancha.push({ id: c.id, nombre: c.nombre, precioHora: Number(c.precioHora), precioHoraPico: Number(c.precioHoraPico), free });
      for (const h of free) horasSet.add(h);
    }
    const horas = [...horasSet].sort();
    const libres: Record<string, Record<string, boolean>> = {};
    const precios: Record<string, Record<string, number>> = {};
    for (const pc of perCancha) {
      libres[pc.id] = {};
      precios[pc.id] = {};
      for (const h of horas) {
        libres[pc.id][h] = pc.free.has(h);
        precios[pc.id][h] = precioEfectivo({ precioHora: pc.precioHora, precioHoraPico: pc.precioHoraPico }, fecha, h, cfg);
      }
    }
    return { deporte, fecha, canchas: perCancha.map((pc) => ({ id: pc.id, nombre: pc.nombre, precioHora: pc.precioHora })), horas, libres, precios };
  },
};
