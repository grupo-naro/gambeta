import { getEnv } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { canchaService } from './cancha.service.js';
import { configService } from './config.service.js';
import { jornadaWindowUtc, minutoDeJornada, hhmmDeMin, instanteDeJornada, hhmmAMin, dayOfWeekInTz } from '../utils/tz.js';
import { ocupacionService } from './ocupacion.service.js';
import { canchaRepo } from '../repositories/cancha.repo.js';
import { precioDeRango, DURACION_DEFAULT_MIN, reglasDeAgenda } from './precio.service.js';

// El paso de la grilla ya no es global: sale de reglasDeAgenda() según el deporte de la cancha.

function horarioDe(fecha: string, tz: string, cfg: { horaApertura: string; horaCierre: string; horaAperturaFinde: string; horaCierreFinde: string }) {
  const dow = dayOfWeekInTz(fecha, tz); // 0=domingo .. 6=sábado
  const finde = dow === 0 || dow === 6;
  return finde
    ? { apertura: cfg.horaAperturaFinde, cierre: cfg.horaCierreFinde }
    : { apertura: cfg.horaApertura, cierre: cfg.horaCierre };
}

export interface DuracionSlot { min: number; horaFin: string; precio: number }
export interface Slot { horaInicio: string; horaFin: string; inicioUtc: string; finUtc: string; duraciones: DuracionSlot[] }

export const disponibilidadService = {
  async listar(canchaId: string, fecha: string): Promise<{ canchaId: string; fecha: string; slots: Slot[] }> {
    const cancha = await canchaService.get(canchaId);
    const tz = getEnv().TZ_NEGOCIO;
    const cfg = await configService.get();
    const { apertura, cierre } = horarioDe(fecha, tz, cfg);
    // Ventana de la JORNADA, no del día calendario: con la ventana de 24 horas, una reserva a las
    // 00:00 cae afuera y la grilla la mostraría libre estando ocupada.
    const { start, end } = jornadaWindowUtc(fecha, tz, apertura, cierre);

    const sectores = await prisma.canchaSector.findMany({ where: { canchaId }, select: { sectorId: true } });
    const sectorIds = sectores.map((s) => s.sectorId);
    const ocup = await prisma.reservaSector.findMany({
      where: { sectorId: { in: sectorIds }, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA'] }, fechaInicio: { gte: start, lt: end } },
      select: { fechaInicio: true, fechaFin: true },
    });

    const plantillas = await ocupacionService.rangosPlantilla(canchaId, fecha);

    const slots: Slot[] = [];
    const cierreM = minutoDeJornada(cierre, apertura);
    // instanteDeJornada instancia un Intl.DateTimeFormat por llamada (~90µs); con 8 canchas
    // y slots de 30' en un día completo son miles de llamadas por request de grilla. Memoizado
    // por minuto: dentro de un mismo `listar` el resultado para un mismo minuto es siempre igual.
    const cacheUtc = new Map<number, Date>();
    const utcDe = (m: number) => {
      let d = cacheUtc.get(m);
      if (!d) { d = instanteDeJornada(fecha, m, tz); cacheUtc.set(m, d); }
      return d;
    };
    // `libre` responde si el rango [ini, fin) en minutos está libre de reservas y de plantillas.
    const libre = (ini: number, fin: number) => {
      const iniUtc = utcDe(ini);
      const finUtc = utcDe(fin);
      const pisaReserva = ocup.some((r) => r.fechaInicio < finUtc && iniUtc < r.fechaFin);
      const pisaPlantilla = plantillas.some((p) => p.ini < fin && ini < p.fin);
      return !pisaReserva && !pisaPlantilla;
    };

    // El paso y las duraciones dependen del deporte: fútbol se agenda por hora en punto,
    // pádel cada media hora y con turnos de hasta 2 horas.
    const { pasoMin, duracionesMin, desfaseMin } = reglasDeAgenda(cancha);

    for (let t = hhmmAMin(apertura) + desfaseMin; t + pasoMin <= cierreM; t += pasoMin) {
      const duraciones: DuracionSlot[] = [];
      for (const min of duracionesMin) {
        if (t + min > cierreM) continue; // no puede pasar del cierre
        if (!libre(t, t + min)) continue; // no puede pisar nada
        duraciones.push({
          min,
          horaFin: hhmmDeMin(t + min),
          precio: precioDeRango(cancha, fecha, hhmmDeMin(t), min, cfg),
        });
      }
      if (duraciones.length === 0) continue; // un slot sin duraciones viables no se publica
      const horaInicio = hhmmDeMin(t);
      // horaFin es el campo legado que consumen el bot y el panel: SIEMPRE una hora fija (60'),
      // sin relación con el paso de la grilla. NO reemplazar por `pasoMin`: en pádel pasaría a
      // publicar "18:00–18:30" en vez de "18:00–19:00".
      const horaFin = hhmmDeMin(t + DURACION_DEFAULT_MIN);
      slots.push({
        horaInicio,
        horaFin,
        inicioUtc: utcDe(t).toISOString(),
        finUtc: utcDe(t + DURACION_DEFAULT_MIN).toISOString(),
        duraciones,
      });
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
    // Orden de JORNADA, no alfabético: "00:00" (el cierre de madrugada) va al final, no al
    // principio — este endpoint lo consume el bot de WhatsApp, que le ofrecería "00:00" como
    // primera opción del día si se ordenara como string. Mismo criterio que ya usa grilla().
    const cfg = await configService.get();
    const { apertura } = horarioDe(fecha, getEnv().TZ_NEGOCIO, cfg);
    const slots = [...byHora.values()].sort((a, b) => minutoDeJornada(a.horaInicio, apertura) - minutoDeJornada(b.horaInicio, apertura));
    return { jugadores, fecha, slots };
  },

  async grilla(deporte: 'futbol' | 'padel', fecha: string): Promise<{
    deporte: string; fecha: string;
    canchas: { id: string; nombre: string; precioHora: number }[];
    horas: string[];
    libres: Record<string, Record<string, boolean>>;
    precios: Record<string, Record<string, number>>;
    duraciones: Record<string, Record<string, DuracionSlot[]>>;
  }> {
    const todas = await canchaRepo.list(true);
    const canchas = todas.filter((c) =>
      deporte === 'futbol' ? c.tipo.toLowerCase().startsWith('futbol') : c.tipo.toLowerCase() === 'padel',
    );
    const cfg = await configService.get();
    const perCancha: { id: string; nombre: string; precioHora: number; precioHoraPico: number; free: Set<string>; porHora: Map<string, DuracionSlot[]> }[] = [];
    const horasSet = new Set<string>();
    for (const c of canchas) {
      const { slots } = await this.listar(c.id, fecha);
      const futuros = slots.filter((s) => new Date(s.inicioUtc).getTime() > Date.now());
      const free = new Set(futuros.map((s) => s.horaInicio));
      const porHora = new Map<string, DuracionSlot[]>();
      for (const s of futuros) porHora.set(s.horaInicio, s.duraciones);
      perCancha.push({ id: c.id, nombre: c.nombre, precioHora: Number(c.precioHora), precioHoraPico: Number(c.precioHoraPico), free, porHora });
      for (const h of free) horasSet.add(h);
    }
    const { apertura } = horarioDe(fecha, getEnv().TZ_NEGOCIO, cfg);
    const horas = [...horasSet].sort((a, b) => minutoDeJornada(a, apertura) - minutoDeJornada(b, apertura));
    const libres: Record<string, Record<string, boolean>> = {};
    const precios: Record<string, Record<string, number>> = {};
    const duraciones: Record<string, Record<string, DuracionSlot[]>> = {};
    for (const pc of perCancha) {
      libres[pc.id] = {};
      precios[pc.id] = {};
      duraciones[pc.id] = {};
      for (const h of horas) {
        libres[pc.id][h] = pc.free.has(h);
        precios[pc.id][h] = precioDeRango({ precioHora: pc.precioHora, precioHoraPico: pc.precioHoraPico }, fecha, h, 60, cfg);
        duraciones[pc.id][h] = pc.porHora.get(h) ?? [];
      }
    }
    return { deporte, fecha, canchas: perCancha.map((pc) => ({ id: pc.id, nombre: pc.nombre, precioHora: pc.precioHora })), horas, libres, precios, duraciones };
  },
};
