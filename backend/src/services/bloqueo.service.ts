import { prisma } from '../db/prisma.js';
import { BusinessRule, Conflict, NotFound } from '../utils/errors.js';
import { ocupacionService } from './ocupacion.service.js';
import { sheetsSync } from './sheets/sheetsSync.service.js';
import { dayOfWeekInTz, minutoDeJornada, hhmmAMin, cierreMin } from '../utils/tz.js';
import { getEnv } from '../config/env.js';
import { configService } from './config.service.js';
import { cobroRepo } from '../repositories/cobro.repo.js';
import { adminUserRepo } from '../repositories/adminUser.repo.js';

const plata = (n: number) => '$' + n.toLocaleString('es-AR');

export const bloqueoService = {
  // El panel compara el período como string YYYY-MM-DD contra el día que dibuja; un ISO completo
  // ("2026-12-12T00:00:00.000Z") rompería esa comparación en el "desde".
  list: async (canchaId?: string) => {
    const rows = await prisma.bloqueo.findMany({ where: canchaId ? { canchaId } : {}, include: { cancha: { select: { nombre: true } }, excepciones: true }, orderBy: { creadoEn: 'desc' } });
    const cobrado = await cobroRepo.sumByBloqueos(rows.filter((b) => b.valor != null).map((b) => b.id));
    return rows.map((b) => ({
      ...b,
      valor: b.valor == null ? null : Number(b.valor),
      // null si el bloqueo no tiene valor: no es un evento con plata.
      pagado: b.valor == null ? null : (cobrado.get(b.id) ?? 0),
      saldo: b.valor == null ? null : Math.max(0, Number(b.valor) - (cobrado.get(b.id) ?? 0)),
      vigenciaDesde: b.vigenciaDesde ? b.vigenciaDesde.toISOString().slice(0, 10) : null,
      vigenciaHasta: b.vigenciaHasta ? b.vigenciaHasta.toISOString().slice(0, 10) : null,
    }));
  },
  async crear(input: { canchaId: string; motivo: 'TORNEO' | 'ENTRENAMIENTO' | 'MANTENIMIENTO' | 'OTRO'; recurrente: boolean; diaSemana?: number; fecha?: string; horaInicio: string; horaFin: string; nota?: string; vigenciaDesde?: string; vigenciaHasta?: string; valor?: number; montoPagado?: number; medioPago?: 'EFECTIVO' | 'TRANSFERENCIA' }, adminId: string | null = null) {
    const opts = input.recurrente
      ? { diaSemana: input.diaSemana, vigencia: { desde: input.vigenciaDesde, hasta: input.vigenciaHasta } }
      : { fecha: input.fecha };
    const dia = input.recurrente ? input.diaSemana! : dayOfWeekInTz(input.fecha!, getEnv().TZ_NEGOCIO);
    const cfg = await configService.get();
    const esFinde = dia === 0 || dia === 6;
    const apertura = esFinde ? cfg.horaAperturaFinde : cfg.horaApertura;
    const choca = await ocupacionService.conflictoAlCrear(input.canchaId, opts, minutoDeJornada(input.horaInicio, apertura), minutoDeJornada(input.horaFin, apertura));
    if (choca) throw Conflict('Ese horario ya está ocupado (otra reserva, fijo o bloqueo)');
    const adminExists = adminId ? !!(await adminUserRepo.findById(adminId)) : false;
    // Bloqueo y seña en una sola transacción: no puede quedar un evento sin su cobro (ni al revés).
    const creado = await prisma.$transaction(async (tx) => {
      const b = await tx.bloqueo.create({
      data: {
        canchaId: input.canchaId, motivo: input.motivo, recurrente: input.recurrente,
        diaSemana: input.recurrente ? input.diaSemana! : null,
        fecha: input.recurrente ? null : new Date(input.fecha! + 'T00:00:00.000Z'),
        horaInicio: input.horaInicio, horaFin: input.horaFin, nota: input.nota ?? null,
        // El período solo existe en recurrentes (el validador ya rechaza mandarlo en un puntual).
        vigenciaDesde: input.recurrente && input.vigenciaDesde ? new Date(input.vigenciaDesde + 'T00:00:00.000Z') : null,
        vigenciaHasta: input.recurrente && input.vigenciaHasta ? new Date(input.vigenciaHasta + 'T00:00:00.000Z') : null,
        valor: input.recurrente ? null : (input.valor ?? null),
      },
      });
      if (input.valor != null && input.montoPagado != null) {
        await tx.cobro.create({ data: { bloqueoId: b.id, monto: input.montoPagado, medio: input.medioPago!, origen: 'EVENTO', registradoPorId: adminExists ? adminId : null } });
      }
      return b;
    });
    sheetsSync.marcarSemanaSucia();
    return creado;
  },
  /**
   * Edición parcial. El tipo (recurrente/puntual) no cambia. Si se toca el puesto (cancha, día,
   * fecha, horas, período) se revalida el choque ignorando al propio bloqueo. El valor del evento
   * no puede quedar por debajo de lo ya cobrado, ni sacarse si hay cobros.
   */
  async editar(id: string, c: { canchaId?: string; motivo?: 'TORNEO' | 'ENTRENAMIENTO' | 'MANTENIMIENTO' | 'OTRO'; diaSemana?: number; fecha?: string; horaInicio?: string; horaFin?: string; nota?: string; vigenciaDesde?: string | null; vigenciaHasta?: string | null; valor?: number | null }) {
    const b = await prisma.bloqueo.findUnique({ where: { id } });
    if (!b) throw NotFound('Bloqueo', id);
    const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    const nuevo = {
      canchaId: c.canchaId ?? b.canchaId,
      diaSemana: b.recurrente ? (c.diaSemana ?? b.diaSemana) : null,
      fecha: b.recurrente ? null : (c.fecha ?? ymd(b.fecha)),
      horaInicio: c.horaInicio ?? b.horaInicio,
      horaFin: c.horaFin ?? b.horaFin,
      vigenciaDesde: b.recurrente ? (c.vigenciaDesde === undefined ? ymd(b.vigenciaDesde) : c.vigenciaDesde) : null,
      vigenciaHasta: b.recurrente ? (c.vigenciaHasta === undefined ? ymd(b.vigenciaHasta) : c.vigenciaHasta) : null,
    };
    if (hhmmAMin(nuevo.horaInicio) >= cierreMin(nuevo.horaFin)) throw BusinessRule('La hora de inicio debe ser anterior al fin');
    if (nuevo.vigenciaDesde && nuevo.vigenciaHasta && nuevo.vigenciaDesde > nuevo.vigenciaHasta) throw BusinessRule('El período está invertido');
    if (!b.recurrente && (c.diaSemana != null || c.vigenciaDesde != null || c.vigenciaHasta != null)) throw BusinessRule('El día y el período solo aplican a bloqueos recurrentes');
    if (b.recurrente && c.fecha != null) throw BusinessRule('La fecha solo aplica a bloqueos de una fecha');
    if (nuevo.canchaId !== b.canchaId && !(await prisma.cancha.findUnique({ where: { id: nuevo.canchaId }, select: { id: true } }))) throw NotFound('Cancha', nuevo.canchaId);

    let valor: number | null = b.valor == null ? null : Number(b.valor);
    if (c.valor !== undefined) {
      if (b.recurrente && c.valor !== null) throw BusinessRule('El valor solo aplica a bloqueos de una fecha (eventos)');
      const cobrado = (await cobroRepo.sumByBloqueos([id])).get(id) ?? 0;
      if (c.valor === null && cobrado > 0) throw BusinessRule('No se puede sacar el valor: el evento ya tiene cobros. Anulalos primero.');
      if (c.valor !== null && c.valor < cobrado) throw BusinessRule(`El valor no puede ser menor a lo ya cobrado (${plata(cobrado)})`);
      valor = c.valor;
    }

    const mueve = nuevo.canchaId !== b.canchaId || nuevo.horaInicio !== b.horaInicio || nuevo.horaFin !== b.horaFin
      || nuevo.diaSemana !== b.diaSemana || nuevo.fecha !== ymd(b.fecha)
      || nuevo.vigenciaDesde !== ymd(b.vigenciaDesde) || nuevo.vigenciaHasta !== ymd(b.vigenciaHasta);
    if (mueve) {
      const dia = b.recurrente ? nuevo.diaSemana! : dayOfWeekInTz(nuevo.fecha!, getEnv().TZ_NEGOCIO);
      const cfg = await configService.get();
      const apertura = dia === 0 || dia === 6 ? cfg.horaAperturaFinde : cfg.horaApertura;
      const opts = b.recurrente
        ? { diaSemana: nuevo.diaSemana!, vigencia: { desde: nuevo.vigenciaDesde ?? undefined, hasta: nuevo.vigenciaHasta ?? undefined }, excluirBloqueoId: id }
        : { fecha: nuevo.fecha!, excluirBloqueoId: id };
      if (await ocupacionService.conflictoAlCrear(nuevo.canchaId, opts, minutoDeJornada(nuevo.horaInicio, apertura), minutoDeJornada(nuevo.horaFin, apertura))) {
        throw Conflict('Ese horario ya está ocupado (otra reserva, fijo o bloqueo)');
      }
    }

    const actualizado = await prisma.bloqueo.update({
      where: { id },
      data: {
        canchaId: nuevo.canchaId, motivo: c.motivo ?? b.motivo,
        diaSemana: nuevo.diaSemana,
        fecha: nuevo.fecha ? new Date(nuevo.fecha + 'T00:00:00.000Z') : null,
        horaInicio: nuevo.horaInicio, horaFin: nuevo.horaFin,
        nota: c.nota === undefined ? b.nota : (c.nota.trim() === '' ? null : c.nota),
        vigenciaDesde: nuevo.vigenciaDesde ? new Date(nuevo.vigenciaDesde + 'T00:00:00.000Z') : null,
        vigenciaHasta: nuevo.vigenciaHasta ? new Date(nuevo.vigenciaHasta + 'T00:00:00.000Z') : null,
        valor,
      },
    });
    sheetsSync.marcarSemanaSucia();
    return actualizado;
  },
  async eliminar(id: string) {
    const b = await prisma.bloqueo.findUnique({ where: { id } });
    if (!b) throw NotFound('Bloqueo', id);
    await prisma.bloqueo.delete({ where: { id } });
    sheetsSync.marcarSemanaSucia();
    return { ok: true };
  },
  /** Cobros de un evento, con valor, pagado y saldo (misma forma que los del abono de un fijo). */
  async listarCobros(id: string) {
    const b = await prisma.bloqueo.findUnique({ where: { id } });
    if (!b) throw NotFound('Bloqueo', id);
    const cobros = await cobroRepo.listByBloqueo(id);
    const valor = b.valor == null ? 0 : Number(b.valor);
    const pagado = cobros.reduce((s, c) => s + Number(c.monto), 0);
    return {
      valor, monto: valor, pagado, saldo: Math.max(0, valor - pagado),
      cobros: cobros.map((c) => ({ id: c.id, monto: Number(c.monto), medio: c.medio, origen: c.origen, registradoPor: c.registradoPor?.nombre ?? 'Sistema', creadoEn: c.creadoEn })),
    };
  },
  /** Otro pago del evento (el saldo el día del cumpleaños). No puede superar lo que falta. */
  async registrarCobro(id: string, input: { monto: number; medio: 'EFECTIVO' | 'TRANSFERENCIA' }, adminId: string | null) {
    const b = await prisma.bloqueo.findUnique({ where: { id } });
    if (!b) throw NotFound('Bloqueo', id);
    if (b.valor == null) throw BusinessRule('Este bloqueo no tiene valor: no hay nada que cobrar');
    const yaPagado = (await cobroRepo.sumByBloqueos([id])).get(id) ?? 0;
    const saldo = Math.max(0, Number(b.valor) - yaPagado);
    if (input.monto > saldo) throw BusinessRule(saldo === 0 ? 'El evento ya está pago por completo' : `El pago supera el saldo del evento: faltan ${plata(saldo)}`);
    const adminExists = adminId ? !!(await adminUserRepo.findById(adminId)) : false;
    const cobro = await cobroRepo.create({ bloqueoId: id, monto: input.monto, medio: input.medio, origen: 'EVENTO', registradoPorId: adminExists ? adminId : null });
    const pagado = yaPagado + input.monto;
    return { cobro: { id: cobro.id, monto: Number(cobro.monto), medio: cobro.medio }, pagado, saldo: Math.max(0, Number(b.valor) - pagado) };
  },
  async agregarExcepcion(id: string, fecha: string) {
    const b = await prisma.bloqueo.findUnique({ where: { id } });
    if (!b) throw NotFound('Bloqueo', id);
    const creado = await prisma.bloqueoExcepcion.upsert({
      where: { bloqueoId_fecha: { bloqueoId: id, fecha: new Date(fecha + 'T00:00:00.000Z') } },
      create: { bloqueoId: id, fecha: new Date(fecha + 'T00:00:00.000Z') }, update: {},
    });
    sheetsSync.marcarSemanaSucia();
    return creado;
  },
  async quitarExcepcion(id: string, fecha: string) {
    await prisma.bloqueoExcepcion.deleteMany({ where: { bloqueoId: id, fecha: new Date(fecha + 'T00:00:00.000Z') } });
    sheetsSync.marcarSemanaSucia();
    return { ok: true };
  },
};
