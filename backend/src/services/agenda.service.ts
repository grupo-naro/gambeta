import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';
import { dayOfWeekInTz, jornadaWindowUtc, hhmmAMin, cierreMin } from '../utils/tz.js';
import { precioDeRango } from './precio.service.js';
import { configService } from './config.service.js';
import { reservaService } from './reserva.service.js';

export const agendaService = {
  async delDia(fecha: string) {
    const tz = getEnv().TZ_NEGOCIO;
    const dia = dayOfWeekInTz(fecha, tz);
    const fechaDate = new Date(fecha + 'T00:00:00.000Z');
    const cfg = await configService.get();
    // La agenda de un día es la de su JORNADA: el turno de las 00:00 pertenece al día anterior.
    // `caja`, `alquileres` y `analytics` NO usan esto — responden preguntas contables por día
    // calendario, y ahí la fecha del instante es la correcta.
    const esFinde = dia === 0 || dia === 6;
    const { start: inicioDia, end: finDia } = jornadaWindowUtc(
      fecha, tz,
      esFinde ? cfg.horaAperturaFinde : cfg.horaApertura,
      esFinde ? cfg.horaCierreFinde : cfg.horaCierre,
    );

    const reservasRaw = await reservaService.list({ fecha });
    // Hasta cuándo está pago el abono del fijo que originó cada reserva. Se resuelve acá (y no en
    // reservaService.list, que se usa en más lugares) para no cambiar la forma de otras respuestas.
    // El panel compara este dato contra la fecha que está mirando para decidir si avisa; el backend
    // no calcula "vencido": cada pantalla mira un día distinto.
    const fijoIds = [...new Set(reservasRaw.map((r) => r.turnoFijoId).filter((id): id is string => id != null))];
    const vigencias = fijoIds.length
      ? await prisma.turnoFijo.findMany({ where: { id: { in: fijoIds } }, select: { id: true, vigenciaHasta: true } })
      : [];
    const vigenciaPorFijo = new Map(vigencias.map((v) => [v.id, v.vigenciaHasta]));
    const reservas = reservasRaw.map((r) => ({
      ...r,
      abonoHasta: r.turnoFijoId && vigenciaPorFijo.get(r.turnoFijoId)
        ? vigenciaPorFijo.get(r.turnoFijoId)!.toISOString().slice(0, 10)
        : null,
    }));

    // fijos materializados ese día → para no duplicar
    const materializados = await prisma.reserva.findMany({
      where: { turnoFijoId: { not: null }, fechaInicio: { gte: inicioDia, lt: finDia } },
      select: { turnoFijoId: true },
    });
    const yaMat = new Set(materializados.map((r) => r.turnoFijoId));

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
        // cierreMin() mapea "00:00" a 1440 para no dar duración negativa en un fijo que cierra
        // a medianoche (ver mismo fix en turnoFijo.service.ts).
        precio: precioDeRango(f.cancha, fecha, f.horaInicio, cierreMin(f.horaFin) - hhmmAMin(f.horaInicio), cfg),
        // Antes de materializarse, el fijo se muestra tal cual (FijoCard): sin estos dos campos
        // el aviso de abono vencido no podía dispararse hasta que alguien cobraba el turno.
        abonoHasta: f.vigenciaHasta ? f.vigenciaHasta.toISOString().slice(0, 10) : null,
        conAbono: f.montoAbono != null,
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
