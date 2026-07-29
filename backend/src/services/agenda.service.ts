import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';
import { dayOfWeekInTz, combineDateTimeUtc } from '../utils/tz.js';
import { precioEfectivo } from './precio.service.js';
import { configService } from './config.service.js';
import { reservaService } from './reserva.service.js';

export const agendaService = {
  async delDia(fecha: string) {
    const tz = getEnv().TZ_NEGOCIO;
    const dia = dayOfWeekInTz(fecha, tz);
    const fechaDate = new Date(fecha + 'T00:00:00.000Z');
    const inicioDia = combineDateTimeUtc(fecha, '00:00', tz);
    const finDia = new Date(inicioDia.getTime() + 86400000);

    const reservas = await reservaService.list({ fecha });

    // fijos materializados ese día → para no duplicar
    const materializados = await prisma.reserva.findMany({
      where: { turnoFijoId: { not: null }, fechaInicio: { gte: inicioDia, lt: finDia } },
      select: { turnoFijoId: true },
    });
    const yaMat = new Set(materializados.map((r) => r.turnoFijoId));

    const cfg = await configService.get();
    const fijosRaw = await prisma.turnoFijo.findMany({
      where: { activo: true, diaSemana: dia },
      include: { cancha: true, excepciones: { where: { fecha: fechaDate } } },
    });
    const fijos = fijosRaw
      .filter((f) => f.excepciones.length === 0 && !yaMat.has(f.id))
      .map((f) => ({
        turnoFijoId: f.id,
        canchaId: f.canchaId,
        cancha: { nombre: f.cancha.nombre },
        clienteNombre: f.clienteNombre,
        whatsapp: f.whatsapp,
        horaInicio: f.horaInicio,
        horaFin: f.horaFin,
        precio: precioEfectivo(f.cancha, fecha, f.horaInicio, cfg),
      }));

    const bloqueosRaw = await prisma.bloqueo.findMany({
      where: { activo: true, OR: [{ recurrente: true, diaSemana: dia }, { recurrente: false, fecha: fechaDate }] },
      include: { cancha: true, excepciones: { where: { fecha: fechaDate } } },
    });
    const bloqueos = bloqueosRaw.filter((b) => b.excepciones.length === 0).map((b) => ({
      id: b.id, canchaId: b.canchaId, motivo: b.motivo, recurrente: b.recurrente,
      diaSemana: b.diaSemana, fecha: b.fecha, horaInicio: b.horaInicio, horaFin: b.horaFin,
      nota: b.nota, cancha: { nombre: b.cancha.nombre },
    }));

    return { reservas, fijos, bloqueos };
  },
};
