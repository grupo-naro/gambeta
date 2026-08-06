import { prisma } from '../db/prisma.js';
import { Conflict, NotFound, BusinessRule } from '../utils/errors.js';
import { ocupacionService } from './ocupacion.service.js';
import { combineDateTimeUtc, dayOfWeekInTz, hhmmAMin, cierreMin } from '../utils/tz.js';
import { getEnv } from '../config/env.js';
import { precioDeRango } from './precio.service.js';
import { configService } from './config.service.js';
import { reservaRepo } from '../repositories/reserva.repo.js';
import { cobroRepo } from '../repositories/cobro.repo.js';
import { sheetsSync } from './sheets/sheetsSync.service.js';
import { resolverCondiciones } from './reserva.condiciones.js';
import { suscripcionService } from './suscripcion.service.js';
import { adminUserRepo } from '../repositories/adminUser.repo.js';

const fromHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const assertFecha = (fecha: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw BusinessRule('Fecha inválida (YYYY-MM-DD)'); };
// Dígitos significativos de un whatsapp argentino (área + número), ignorando +, espacios
// y el prefijo 54/549. Permite comparar el número cargado a mano en el panel con el JID del bot.
const local10 = (s?: string | null) => { const d = (s ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };

// Al liberar un fijo para una fecha, si ese fijo ya fue MATERIALIZADO en una reserva concreta
// ese día, hay que cancelar esa reserva; si no, la excepción oculta la plantilla pero el slot
// sigue ocupado por la reserva. Se cancela sin la ventana de anticipación (es staff/sistema).
async function cancelarReservaMaterializada(fijoId: string, fecha: string): Promise<number> {
  const tz = getEnv().TZ_NEGOCIO;
  const inicioDia = combineDateTimeUtc(fecha, '00:00', tz);
  const finDia = new Date(inicioDia.getTime() + 86400000);
  const mats = await prisma.reserva.findMany({
    where: { turnoFijoId: fijoId, fechaInicio: { gte: inicioDia, lt: finDia }, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA'] } },
    select: { id: true },
  });
  for (const m of mats) await reservaRepo.updateEstado(m.id, 'CANCELADA');
  return mats.length;
}

export const turnoFijoService = {
  list: async (canchaId?: string) => {
    const fijos = await prisma.turnoFijo.findMany({
      where: canchaId ? { canchaId } : {},
      include: { cancha: { select: { nombre: true } }, excepciones: true },
      orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }],
    });
    // El panel compara estas fechas como string YYYY-MM-DD contra el día que está mirando; no le
    // sirve un ISO completo ni un Date.
    return fijos.map((f) => ({
      ...f,
      vigenciaDesde: f.vigenciaDesde ? f.vigenciaDesde.toISOString().slice(0, 10) : null,
      vigenciaHasta: f.vigenciaHasta ? f.vigenciaHasta.toISOString().slice(0, 10) : null,
      montoAbono: f.montoAbono == null ? null : Number(f.montoAbono),
    }));
  },
  async crear(input: {
    canchaId: string; clienteNombre: string; whatsapp?: string; diaSemana: number; horaInicio: string; horaFin: string;
    vigenciaDesde?: string; vigenciaHasta?: string; montoAbono?: number; medioAbono?: 'EFECTIVO' | 'TRANSFERENCIA';
  }, adminId: string | null = null) {
    const choca = await ocupacionService.conflictoAlCrear(input.canchaId, { diaSemana: input.diaSemana }, fromHHMM(input.horaInicio), fromHHMM(input.horaFin));
    if (choca) throw Conflict('Ese horario ya está ocupado (otra reserva, fijo o bloqueo)');

    const { vigenciaDesde, vigenciaHasta, montoAbono, medioAbono, ...datosFijo } = input;
    const conAbono = montoAbono != null;
    // El admin del JWT puede haber sido borrado desde que se emitió el token; sin esta guarda
    // la FK de Cobro explota dentro de la transacción y ni el cobro ni el fijo se crean.
    const adminExists = adminId ? !!(await adminUserRepo.findById(adminId)) : false;
    const registradoPorId = adminExists ? adminId : null;

    const creado = await prisma.$transaction(async (tx) => {
      const fijo = await tx.turnoFijo.create({
        data: {
          ...datosFijo,
          vigenciaDesde: vigenciaDesde ? new Date(vigenciaDesde + 'T00:00:00.000Z') : null,
          vigenciaHasta: vigenciaHasta ? new Date(vigenciaHasta + 'T00:00:00.000Z') : null,
          montoAbono: montoAbono ?? null,
        },
      });
      // El abono se cobra una sola vez, al dar de alta. Sin esto la plata no aparece en caja:
      // los turnos salen 0 y el ingreso se perdería.
      if (conAbono) {
        await cobroRepo.create({
          turnoFijoId: fijo.id, reservaId: null, suscripcionId: null,
          monto: montoAbono, medio: medioAbono!, origen: 'ABONO', registradoPorId,
        }, tx);
      }
      return fijo;
    });

    if (input.whatsapp) {
      await prisma.cliente.upsert({
        where: { whatsapp: input.whatsapp },
        create: { whatsapp: input.whatsapp, nombre: input.clienteNombre, nombreConfirmado: true },
        update: {},
      });
    }
    sheetsSync.marcarSemanaSucia();
    return creado;
  },
  async eliminar(id: string) {
    const f = await prisma.turnoFijo.findUnique({ where: { id } });
    if (!f) throw NotFound('TurnoFijo', id);
    try {
      await prisma.turnoFijo.delete({ where: { id } });
    } catch (e: any) {
      // Un fijo con abono tiene cobros asociados (onDelete: Restrict): borrarlo perdería el
      // rastro en la caja. El camino correcto es desactivarlo.
      if (e?.code === 'P2003') throw BusinessRule('Este turno fijo tiene un abono cobrado. Desactivalo en vez de borrarlo.');
      throw e;
    }
    sheetsSync.marcarSemanaSucia();
    return { ok: true };
  },
  async desactivar(id: string) {
    const f = await prisma.turnoFijo.findUnique({ where: { id } });
    if (!f) throw NotFound('TurnoFijo', id);
    await prisma.turnoFijo.update({ where: { id }, data: { activo: false } });
    sheetsSync.marcarSemanaSucia();
    return { ok: true };
  },
  async agregarExcepcion(id: string, fecha: string) {
    const f = await prisma.turnoFijo.findUnique({ where: { id } });
    if (!f) throw NotFound('TurnoFijo', id);
    const creado = await prisma.turnoFijoExcepcion.upsert({
      where: { turnoFijoId_fecha: { turnoFijoId: id, fecha: new Date(fecha + 'T00:00:00.000Z') } },
      create: { turnoFijoId: id, fecha: new Date(fecha + 'T00:00:00.000Z') }, update: {},
    });
    await cancelarReservaMaterializada(id, fecha);
    sheetsSync.marcarSemanaSucia();
    return creado;
  },
  async liberarPorWhatsapp(whatsapp: string, fecha: string) {
    const dow = dayOfWeekInTz(fecha, getEnv().TZ_NEGOCIO);
    const target = local10(whatsapp);
    const candidatos = await prisma.turnoFijo.findMany({ where: { activo: true, diaSemana: dow } });
    const fijos = target ? candidatos.filter((f) => local10(f.whatsapp) === target) : [];
    if (!fijos.length) return { liberado: false, cantidad: 0 };
    const fechaDate = new Date(fecha + 'T00:00:00.000Z');
    for (const f of fijos) {
      await prisma.turnoFijoExcepcion.upsert({
        where: { turnoFijoId_fecha: { turnoFijoId: f.id, fecha: fechaDate } },
        create: { turnoFijoId: f.id, fecha: fechaDate },
        update: {},
      });
      await cancelarReservaMaterializada(f.id, fecha);
    }
    return { liberado: true, cantidad: fijos.length };
  },
  async misFijos(whatsapp: string) {
    const target = local10(whatsapp);
    if (!target) return [];
    const candidatos = await prisma.turnoFijo.findMany({ where: { activo: true }, include: { cancha: true } });
    return candidatos
      .filter((f) => local10(f.whatsapp) === target)
      .sort((a, b) => a.diaSemana - b.diaSemana || a.horaInicio.localeCompare(b.horaInicio))
      .map((f) => ({
        id: f.id,
        diaSemana: f.diaSemana,
        horaInicio: f.horaInicio,
        horaFin: f.horaFin,
        canchaNombre: f.cancha.nombre,
        precio: f.precio == null ? null : Number(f.precio),
      }));
  },
  async quitarExcepcion(id: string, fecha: string) {
    assertFecha(fecha);
    await prisma.turnoFijoExcepcion.deleteMany({ where: { turnoFijoId: id, fecha: new Date(fecha + 'T00:00:00.000Z') } });
    sheetsSync.marcarSemanaSucia();
    return { ok: true };
  },
  async materializar(fijoId: string, fecha: string) {
    const tz = getEnv().TZ_NEGOCIO;
    const fijo = await prisma.turnoFijo.findUnique({ where: { id: fijoId }, include: { cancha: true } });
    if (!fijo || !fijo.activo) throw NotFound('TurnoFijo', fijoId);
    if (!fijo.whatsapp) throw BusinessRule('El turno fijo no tiene WhatsApp; recargalo con el número para poder cobrarlo');
    if (dayOfWeekInTz(fecha, tz) !== fijo.diaSemana) throw BusinessRule('Ese turno fijo no aplica a esa fecha');
    const fechaDate = new Date(fecha + 'T00:00:00.000Z');
    const exc = await prisma.turnoFijoExcepcion.findUnique({ where: { turnoFijoId_fecha: { turnoFijoId: fijoId, fecha: fechaDate } } });
    if (exc) throw BusinessRule('Ese turno fijo está liberado en esa fecha');
    const fechaInicio = combineDateTimeUtc(fecha, fijo.horaInicio, tz);
    const existente = await prisma.reserva.findUnique({ where: { turnoFijoId_fechaInicio: { turnoFijoId: fijoId, fechaInicio } } });
    if (existente) return existente;
    const fechaFin = combineDateTimeUtc(fecha, fijo.horaFin, tz);
    const cfg = await configService.get();
    // cierreMin() mapea "00:00" a 1440: un fijo que cierra a medianoche no debe dar duración
    // negativa (hoy inalcanzable por validación zod, pero queda como riesgo con datos legacy).
    const duracion = cierreMin(fijo.horaFin) - hhmmAMin(fijo.horaInicio);
    const precio = precioDeRango(fijo.cancha, fecha, fijo.horaInicio, duracion, cfg);
    const whatsapp = fijo.whatsapp;
    // Igual que reserva.service.crear: se busca el cliente y su suscripción vigente ANTES de la
    // transacción, solo para leer si hay que bonificar. El upsert de más abajo (dentro de la
    // transacción) sigue siendo el que crea/actualiza el cliente real.
    const clientePrevio = await prisma.cliente.findUnique({ where: { whatsapp } });
    const suscripcion = clientePrevio ? await suscripcionService.vigenteDe(clientePrevio.id) : null;
    const cond = resolverCondiciones({
      esContacto: false,
      porStaff: true,
      clienteConfiable: false,
      precio,
      senaPorDefecto: 0,
      suscripcionId: suscripcion?.id ?? null,
    });
    // Con abono, el turno ya está pagado por el período: sale 0 y el precio real queda en
    // montoLista para que la caja pueda informar cuánto se bonificó. El período NO se compara
    // con la fecha: vencido, el turno igual sale 0 y el panel muestra el aviso de renovar.
    const conAbono = fijo.montoAbono != null;
    return prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.upsert({
        where: { whatsapp },
        create: { whatsapp, nombre: fijo.clienteNombre, nombreConfirmado: true, primeraReserva: new Date(), totalReservas: 1 },
        update: { totalReservas: { increment: 1 } },
      });
      return reservaRepo.create({
        canchaId: fijo.canchaId, clienteId: cliente.id, fechaInicio, fechaFin,
        estado: cond.estado, esContacto: false,
        monto: conAbono ? 0 : cond.monto,
        montoLista: conAbono ? precio : cond.montoLista,
        suscripcionId: cond.suscripcionId, montoSena: null, notas: null, turnoFijoId: fijoId,
      }, tx);
    });
  },
};
