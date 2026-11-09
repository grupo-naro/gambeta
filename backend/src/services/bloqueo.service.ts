import { prisma } from '../db/prisma.js';
import { BadRequest, BusinessRule, Conflict, NotFound } from '../utils/errors.js';
import { ocupacionService } from './ocupacion.service.js';
import { sheetsSync } from './sheets/sheetsSync.service.js';
import { dayOfWeekInTz, minutoDeJornada, hhmmAMin, cierreMin, hoyEnTz } from '../utils/tz.js';
import { getEnv } from '../config/env.js';
import { configService } from './config.service.js';
import { cobroRepo } from '../repositories/cobro.repo.js';
import { adminUserRepo } from '../repositories/adminUser.repo.js';

const plata = (n: number) => '$' + n.toLocaleString('es-AR');
const ymdDe = (d: Date) => d.toISOString().slice(0, 10);

type BloqueoMes = { vigenciaDesde: Date | null; vigenciaHasta: Date | null };

/** Último día ('YYYY-MM-DD') del mes 'YYYY-MM'. */
function ultimoDiaDelMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return mes + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
}
/** Suma meses a un 'YYYY-MM'. */
function sumarMeses(mes: string, n: number): string {
  const [y, m] = mes.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
}
/** ¿El mes cae (aunque sea en parte) dentro del período del entrenamiento? */
function mesEnPeriodo(b: BloqueoMes, mes: string): boolean {
  if (b.vigenciaDesde && ymdDe(b.vigenciaDesde) > ultimoDiaDelMes(mes)) return false;
  if (b.vigenciaHasta && ymdDe(b.vigenciaHasta) < mes + '-01') return false;
  return true;
}
/** El valor de un entrenamiento recurrente es mensual: hay que decir qué mes, y que sea del período. */
function assertMes(b: BloqueoMes, mes: string | undefined): string {
  if (!mes) throw BusinessRule('Indicá el mes: el valor de un entrenamiento recurrente es mensual');
  if (!mesEnPeriodo(b, mes)) throw BusinessRule('Ese mes está fuera del período del entrenamiento');
  return mes;
}

export const bloqueoService = {
  // El panel compara el período como string YYYY-MM-DD contra el día que dibuja; un ISO completo
  // ("2026-12-12T00:00:00.000Z") rompería esa comparación en el "desde".
  list: async (canchaId?: string) => {
    const rows = await prisma.bloqueo.findMany({ where: canchaId ? { canchaId } : {}, include: { cancha: { select: { nombre: true } }, excepciones: true }, orderBy: { creadoEn: 'desc' } });
    // Un recurrente con valor cobra POR CLASE: no tiene un pagado/saldo global.
    const cobrado = await cobroRepo.sumByBloqueos(rows.filter((b) => b.valor != null && !b.recurrente).map((b) => b.id));
    return rows.map((b) => ({
      ...b,
      valor: b.valor == null ? null : Number(b.valor),
      // null si el bloqueo no tiene valor: no es un evento con plata.
      pagado: b.valor == null || b.recurrente ? null : (cobrado.get(b.id) ?? 0),
      saldo: b.valor == null || b.recurrente ? null : Math.max(0, Number(b.valor) - (cobrado.get(b.id) ?? 0)),
      vigenciaDesde: b.vigenciaDesde ? b.vigenciaDesde.toISOString().slice(0, 10) : null,
      vigenciaHasta: b.vigenciaHasta ? b.vigenciaHasta.toISOString().slice(0, 10) : null,
    }));
  },
  async crear(input: { canchaId: string; motivo: 'TORNEO' | 'ENTRENAMIENTO' | 'MANTENIMIENTO' | 'OTRO'; recurrente: boolean; diaSemana?: number; fecha?: string; horaInicio: string; horaFin: string; nota?: string; vigenciaDesde?: string; vigenciaHasta?: string; valor?: number; montoPagado?: number; medioPago?: 'EFECTIVO' | 'TRANSFERENCIA' }, adminId: string | null = null) {
    if (input.recurrente && input.valor != null && input.motivo !== 'ENTRENAMIENTO') throw BusinessRule('El valor en un bloqueo recurrente solo aplica a entrenamientos');
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
        valor: input.valor ?? null,
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
      if (b.recurrente && c.valor !== null && (c.motivo ?? b.motivo) !== 'ENTRENAMIENTO') throw BusinessRule('El valor en un bloqueo recurrente solo aplica a entrenamientos');
      const total = (await cobroRepo.sumByBloqueos([id])).get(id) ?? 0;
      if (c.valor === null && total > 0) throw BusinessRule('No se puede sacar el valor: ya tiene cobros. Anulalos primero.');
      // Evento puntual: contra lo cobrado en total. Entrenamiento: contra el mes en el que más se cobró.
      const cobrado = b.recurrente ? Math.max(0, ...(await cobroRepo.sumByBloqueoPorMes(id)).values()) : total;
      if (c.valor !== null && c.valor < cobrado) throw BusinessRule(b.recurrente
        ? `El valor mensual no puede ser menor a lo ya cobrado en un mes (${plata(cobrado)})`
        : `El valor no puede ser menor a lo ya cobrado (${plata(cobrado)})`);
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
  /**
   * Cobros de un evento, con valor, pagado y saldo (misma forma que los del abono de un fijo). En un
   * entrenamiento recurrente el valor es mensual, así que hay que pedir el `mes` ('YYYY-MM').
   */
  async listarCobros(id: string, mes?: string) {
    const b = await prisma.bloqueo.findUnique({ where: { id } });
    if (!b) throw NotFound('Bloqueo', id);
    const m = b.recurrente ? assertMes(b, mes) : undefined;
    const cobros = await cobroRepo.listByBloqueo(id, m);
    const valor = b.valor == null ? 0 : Number(b.valor);
    const pagado = cobros.reduce((s, c) => s + Number(c.monto), 0);
    return {
      valor, monto: valor, pagado, saldo: Math.max(0, valor - pagado),
      cobros: cobros.map((c) => ({ id: c.id, monto: Number(c.monto), medio: c.medio, origen: c.origen, registradoPor: c.registradoPor?.nombre ?? 'Sistema', creadoEn: c.creadoEn })),
    };
  },
  /** Otro pago del evento (el saldo el día del cumpleaños) o de un mes de un entrenamiento. No puede superar lo que falta. */
  async registrarCobro(id: string, input: { monto: number; medio: 'EFECTIVO' | 'TRANSFERENCIA'; mes?: string }, adminId: string | null) {
    const b = await prisma.bloqueo.findUnique({ where: { id } });
    if (!b) throw NotFound('Bloqueo', id);
    if (b.valor == null) throw BusinessRule('Este bloqueo no tiene valor: no hay nada que cobrar');
    const mes = b.recurrente ? assertMes(b, input.mes) : undefined;
    const yaPagado = mes ? ((await cobroRepo.sumByBloqueoPorMes(id)).get(mes) ?? 0) : ((await cobroRepo.sumByBloqueos([id])).get(id) ?? 0);
    const saldo = Math.max(0, Number(b.valor) - yaPagado);
    const queEs = mes ? 'El mes' : 'El evento';
    if (input.monto > saldo) throw BusinessRule(saldo === 0 ? `${queEs} ya está pago por completo` : `El pago supera el saldo: faltan ${plata(saldo)}`);
    const adminExists = adminId ? !!(await adminUserRepo.findById(adminId)) : false;
    const cobro = await cobroRepo.create({
      bloqueoId: id, bloqueoMes: mes ? new Date(mes + '-01T00:00:00.000Z') : null,
      // Con mes es un entrenamiento (la academia); sin mes, un evento (cumpleaños, etc.).
      monto: input.monto, medio: input.medio, origen: mes ? 'ACADEMIA' : 'EVENTO', registradoPorId: adminExists ? adminId : null,
    });
    const pagado = yaPagado + input.monto;
    return { cobro: { id: cobro.id, monto: Number(cobro.monto), medio: cobro.medio }, pagado, saldo: Math.max(0, Number(b.valor) - pagado) };
  },
  /**
   * Los meses de un entrenamiento recurrente entre dos meses ('YYYY-MM'; por defecto, 5 meses atrás
   * hasta 1 adelante), solo los que caen en su período, con lo cobrado de cada uno.
   */
  async meses(id: string, rango: { desde?: string; hasta?: string } = {}) {
    const b = await prisma.bloqueo.findUnique({ where: { id } });
    if (!b) throw NotFound('Bloqueo', id);
    if (!b.recurrente) throw BusinessRule('Solo los bloqueos recurrentes tienen meses');
    const hoyMes = hoyEnTz(getEnv().TZ_NEGOCIO).slice(0, 7);
    const desde = rango.desde ?? sumarMeses(hoyMes, -5);
    const hasta = rango.hasta ?? sumarMeses(hoyMes, 1);
    if (desde > hasta) throw BadRequest('El rango está invertido');
    if (sumarMeses(desde, 36) < hasta) throw BadRequest('El rango es demasiado largo (máximo 36 meses)');
    const cobrado = await cobroRepo.sumByBloqueoPorMes(id);
    const valor = b.valor == null ? null : Number(b.valor);
    const meses: { mes: string; pagado: number; saldo: number }[] = [];
    for (let m = desde; m <= hasta; m = sumarMeses(m, 1)) {
      if (!mesEnPeriodo(b, m)) continue;
      const pagado = cobrado.get(m) ?? 0;
      meses.push({ mes: m, pagado, saldo: valor == null ? 0 : Math.max(0, valor - pagado) });
    }
    return { valor, meses };
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
