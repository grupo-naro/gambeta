import { Prisma, EstadoReserva } from '../db/client.js';
import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';
import { reservaRepo } from '../repositories/reserva.repo.js';
import { pagoRepo } from '../repositories/pago.repo.js';
import { auditLogRepo } from '../repositories/auditLog.repo.js';
import { cobroRepo } from '../repositories/cobro.repo.js';
import { canchaService } from './cancha.service.js';
import { senaService } from './sena.service.js';
import { configService } from './config.service.js';
import { precioDeRango, DURACION_DEFAULT_MIN, reglasDeAgenda } from './precio.service.js';
import { resolverCondiciones } from './reserva.condiciones.js';
import { suscripcionService } from './suscripcion.service.js';
import { clasificarOrigen } from './visita.service.js';
import { jornadaWindowUtc, dayOfWeekInTz, hoyEnTz, sumarDias, minutoDeJornada, instanteDeJornada } from '../utils/tz.js';
import { BusinessRule, Conflict, NotFound } from '../utils/errors.js';
import { ocupacionService } from './ocupacion.service.js';
import { sheetsSync } from './sheets/sheetsSync.service.js';
import { ymdEnTz } from './sheets/sheetsData.js';
import { evolutionService } from './evolution.service.js';
import { notificacionService, mensajeSenaAprobada } from './notificacion.service.js';
import { logger } from '../utils/logger.js';

const TRANSITIONS: Record<EstadoReserva, EstadoReserva[]> = {
  ESPERANDO_SENA: ['CONFIRMADA', 'CANCELADA'],
  CONFIRMADA: ['CANCELADA', 'COMPLETADA'],
  CANCELADA: [],
  COMPLETADA: [],
};

export function assertTransition(from: EstadoReserva, to: EstadoReserva): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw Conflict(`Transición inválida: ${from} -> ${to}`);
  }
}

/**
 * Fin de la ventana de anticipación pública: el instante exacto en el que deja de poder
 * reservarse. Se usa tanto en `crear` como en `reprogramar` (y en `turnoFijo.service.materializar`)
 * para no duplicar la aritmética de calendario ni el mensaje de error.
 *
 * Es el fin de la JORNADA de `ymd`, no la medianoche de su día calendario: con cierre de
 * madrugada, el turno de las 00:00 de esa jornada se guarda con el instante real del día
 * calendario siguiente, y `dayWindowUtc(ymd).end` caía justo ahí — lo rechazaba con
 * "solo se puede reservar hasta" aunque la grilla pública sí lo publica.
 */
export function limiteAnticipacion(
  cfg: { diasAnticipacionMax: number; horaApertura: string; horaCierre: string; horaAperturaFinde: string; horaCierreFinde: string },
  tz: string,
  desde = '',
): { fin: Date; ymd: string } {
  // Antes de la apertura la ventana cuenta desde el día de apertura: con 7 días de anticipación
  // y apertura el 1/11, el 15/10 el tope sería el 22/10 y ningún turno sería alcanzable.
  const hoy = hoyEnTz(tz);
  const ymd = sumarDias(desde > hoy ? desde : hoy, cfg.diasAnticipacionMax);
  const dow = dayOfWeekInTz(ymd, tz);
  const esFinde = dow === 0 || dow === 6;
  const apertura = esFinde ? cfg.horaAperturaFinde : cfg.horaApertura;
  const cierre = esFinde ? cfg.horaCierreFinde : cfg.horaCierre;
  return { fin: jornadaWindowUtc(ymd, tz, apertura, cierre).end, ymd };
}

/**
 * El público no puede reservar turnos anteriores a la apertura (`RESERVAS_DESDE`). Es una
 * comparación de FECHAS de calendario ("YYYY-MM-DD" ordena como texto), igual que la ventana
 * de anticipación. El staff queda afuera: tiene que poder cargar a mano turnos de prueba o
 * reservas anticipadas.
 */
export function assertReservasAbiertas(fecha: string, desde: string): void {
  if (!desde || fecha >= desde) return;
  const [, mes, dia] = desde.split('-');
  throw BusinessRule(`Las reservas online abren el ${dia}/${mes}`);
}

export interface CreateReservaInput {
  canchaId: string;
  whatsapp: string;
  nombreCliente: string;
  esContacto: boolean;
  fecha: string;
  horaInicio: string;
  duracionMin?: number;
  montoSena?: number;
  metodoSena?: 'MERCADO_PAGO' | 'TRANSFERENCIA';
  nombreConfirmado?: boolean;
  notas?: string;
  origenEtiqueta?: string | null;
}

export const reservaService = {
  async crear(input: CreateReservaInput, opts: { porStaff?: boolean } = {}) {
    const cancha = await canchaService.get(input.canchaId);
    const tz = getEnv().TZ_NEGOCIO;
    const duracionMin = input.duracionMin ?? DURACION_DEFAULT_MIN;
    const cfg = await configService.get();

    // La reserva tiene que terminar antes o justo en el cierre. Antes no hacía falta:
    // todos los turnos medían lo mismo y la grilla ya no ofrecía horarios inválidos.
    const dow = dayOfWeekInTz(input.fecha, tz);
    const esFinde = dow === 0 || dow === 6;
    const apertura = esFinde ? cfg.horaAperturaFinde : cfg.horaApertura;
    const cierre = minutoDeJornada(esFinde ? cfg.horaCierreFinde : cfg.horaCierre, apertura);

    // En minutos de jornada: una hora anterior a la apertura pertenece al día siguiente, así que
    // "00:00" son 1440 y el turno termina a los 1500, dentro de un cierre a la 01:00.
    const iniMin = minutoDeJornada(input.horaInicio, apertura);
    const finMin = iniMin + duracionMin;
    if (finMin > cierre) throw BusinessRule('La reserva termina después del horario de cierre');

    const fechaInicio = instanteDeJornada(input.fecha, iniMin, tz);
    const fechaFin = new Date(fechaInicio.getTime() + duracionMin * 60 * 1000);
    if (fechaInicio.getTime() <= Date.now()) throw BusinessRule('No se puede reservar en el pasado');

    // El público reserva dentro de una ventana móvil; el staff no tiene techo, porque tiene que
    // poder tomar por teléfono una reserva para dentro de un mes. Va pegado al chequeo del pasado
    // a propósito: son la misma pregunta —¿la fecha cae en la ventana permitida?— y separarlos
    // invita a que en un refactor se olvide uno.
    //
    // El límite es una FECHA de calendario, no un instante: con `Date.now() + N días` el último
    // día quedaría partido al medio y los turnos de la noche se rechazarían sin motivo visible.
    if (!opts.porStaff) {
      const desde = getEnv().RESERVAS_DESDE;
      assertReservasAbiertas(input.fecha, desde);
      const { fin, ymd } = limiteAnticipacion(cfg, tz, desde);
      if (fechaInicio >= fin) {
        const [, mes, dia] = ymd.split('-');
        throw BusinessRule(`Por ahora solo se puede reservar hasta el ${dia}/${mes}`);
      }
    }

    // El deporte manda: el fútbol se agenda por hora en punto y no admite 1½ ni 2 horas.
    // El schema zod valida la forma (60/90/120) pero no conoce la cancha, así que la regla
    // por deporte vive acá. Sin este chequeo se puede saltear la grilla y crear por API una
    // reserva de fútbol de dos horas.
    const reglas = reglasDeAgenda(cancha.tipo);
    if (!reglas.duracionesMin.includes(duracionMin)) {
      throw BusinessRule(`Esta cancha solo admite turnos de ${reglas.duracionesMin.map((d) => d / 60).join(', ')} hora(s)`);
    }
    if (iniMin % reglas.pasoMin !== 0) {
      throw BusinessRule(reglas.pasoMin === 60 ? 'Esta cancha se reserva en horas en punto' : 'El turno debe arrancar en punto o y media');
    }

    const motivo = await ocupacionService.conflictoReserva(input.canchaId, input.fecha, iniMin, finMin);
    if (motivo === 'fijo') throw Conflict('Ese horario está tomado por un turno fijo');
    if (motivo === 'bloqueo') throw Conflict('Ese horario está bloqueado');

    const clientePrevio = await prisma.cliente.findUnique({ where: { whatsapp: input.whatsapp } });
    // Congelado al reservar: vale la vigencia de HOY, no la del día del turno. Un socio vigente
    // puede agendar un turno más allá de su vencimiento y sigue bonificado. Mismo criterio que
    // reprogramar, que tampoco recalcula el monto.
    const suscripcion = clientePrevio ? await suscripcionService.vigenteDe(clientePrevio.id) : null;
    const precio = precioDeRango(cancha, input.fecha, input.horaInicio, duracionMin, cfg);
    const cond = resolverCondiciones({
      esContacto: input.esContacto,
      porStaff: !!opts.porStaff,
      clienteConfiable: !!clientePrevio?.confiable,
      precio,
      montoSenaPedido: input.montoSena,
      senaPorDefecto: await senaService.montoParaCancha(cancha, precio),
      suscripcionId: suscripcion?.id ?? null,
    });
    const { estado, montoSena } = cond;

    const reserva = await prisma.$transaction(async (tx) => {
      const existente = await tx.cliente.findUnique({ where: { whatsapp: input.whatsapp } });
      const conservarNombre = !!(existente?.nombreConfirmado && !input.nombreConfirmado);
      const cliente = await tx.cliente.upsert({
        where: { whatsapp: input.whatsapp },
        create: {
          whatsapp: input.whatsapp,
          nombre: input.nombreCliente,
          esContacto: input.esContacto,
          nombreConfirmado: input.nombreConfirmado ?? false,
          primeraReserva: new Date(),
          totalReservas: 1,
        },
        update: {
          nombre: conservarNombre ? existente!.nombre : input.nombreCliente,
          esContacto: input.esContacto,
          nombreConfirmado: input.nombreConfirmado ? true : undefined,
          totalReservas: { increment: 1 },
        },
      });

      const r = await reservaRepo.create(
        {
          canchaId: input.canchaId,
          clienteId: cliente.id,
          fechaInicio,
          fechaFin,
          estado,
          esContacto: input.esContacto,
          monto: cond.monto,
          montoLista: cond.montoLista,
          suscripcionId: cond.suscripcionId,
          montoSena,
          notas: input.notas ?? null,
          // El método solo tiene sentido mientras haya una seña pendiente. Si la reserva sale
          // CONFIRMADA (socio, staff, cliente confiable), guardarlo registraría una intención
          // que nunca se va a ejecutar. La condición es el ESTADO, no el monto.
          metodoSena: estado === 'ESPERANDO_SENA' ? (input.metodoSena ?? null) : null,
          // Mismo criterio que `metodoSena`: si el cliente no vino de ningún link, `null`.
          // El panel y el bot nunca mandan etiqueta, y fabricarles un DIRECTO sería mentir:
          // esa reserva no entró por la web.
          origenEtiqueta: input.origenEtiqueta ?? null,
          origenTipo: input.origenEtiqueta ? clasificarOrigen(input.origenEtiqueta) : null,
        },
        tx,
      );

      if (estado === 'ESPERANDO_SENA') {
        await pagoRepo.upsertForReserva(r.id, { estado: 'PENDIENTE' }, tx);
      }
      return r;
    });

    sheetsSync.marcarSucio(input.fecha);

    const aviso = {
      nombreCliente: input.nombreCliente,
      whatsapp: input.whatsapp,
      canchaNombre: cancha.nombre,
      fechaInicio,
      montoSena: Number(montoSena ?? 0),
    };
    if (estado === 'ESPERANDO_SENA') {
      // Solo la transferencia deja un comprobante por revisar. Con Mercado Pago confirma el webhook.
      if (input.metodoSena === 'TRANSFERENCIA') {
        notificacionService.avisarComprobantePendiente(aviso, cfg.adminWhatsapp, tz);
      }
      return { ...reserva, datosPago: await senaService.datosPago() };
    }
    // Confirmada de entrada (socio, staff, cliente confiable): no habrá aviso de seña aprobada.
    if (reserva.estado === 'CONFIRMADA') notificacionService.avisarReservaConfirmada(aviso, tz);
    return reserva;
  },

  async get(id: string) {
    const r = await reservaRepo.findById(id);
    if (!r) throw NotFound('Reserva', id);
    return r;
  },

  async list(filtros: { fecha?: string; desde?: string; hasta?: string; canchaId?: string; estado?: EstadoReserva; whatsapp?: string }) {
    const where: Prisma.ReservaWhereInput = {};
    if (filtros.canchaId) where.canchaId = filtros.canchaId;
    if (filtros.estado) where.estado = filtros.estado;
    if (filtros.whatsapp) where.cliente = { whatsapp: filtros.whatsapp };
    const tz = getEnv().TZ_NEGOCIO;
    if (filtros.desde && filtros.hasta) {
      // Igual criterio que la rama de `fecha`: el rango cubre la JORNADA de `desde` a la de
      // `hasta`, no el día calendario. Sin esto, el turno de las 00:00 que pertenece a la
      // jornada de `hasta` (guardado con el instante real del día siguiente) quedaba justo
      // en el borde del filtro `lt: end` y se excluía de la semana a la que pertenece.
      const cfg = await configService.get();
      const dowDesde = dayOfWeekInTz(filtros.desde, tz);
      const esFindeDesde = dowDesde === 0 || dowDesde === 6;
      const start = jornadaWindowUtc(
        filtros.desde, tz,
        esFindeDesde ? cfg.horaAperturaFinde : cfg.horaApertura,
        esFindeDesde ? cfg.horaCierreFinde : cfg.horaCierre,
      ).start;
      const dowHasta = dayOfWeekInTz(filtros.hasta, tz);
      const esFindeHasta = dowHasta === 0 || dowHasta === 6;
      const end = jornadaWindowUtc(
        filtros.hasta, tz,
        esFindeHasta ? cfg.horaAperturaFinde : cfg.horaApertura,
        esFindeHasta ? cfg.horaCierreFinde : cfg.horaCierre,
      ).end;
      where.fechaInicio = { gte: start, lt: end };
    } else if (filtros.fecha) {
      // La agenda de un día es la de su JORNADA: el turno de las 00:00 pertenece al día anterior.
      // `caja`, `alquileres` y `analytics` NO usan esto — responden preguntas contables por día
      // calendario, y ahí la fecha del instante es la correcta.
      const cfg = await configService.get();
      const dow = dayOfWeekInTz(filtros.fecha, tz);
      const esFinde = dow === 0 || dow === 6;
      const { start, end } = jornadaWindowUtc(
        filtros.fecha, tz,
        esFinde ? cfg.horaAperturaFinde : cfg.horaApertura,
        esFinde ? cfg.horaCierreFinde : cfg.horaCierre,
      );
      where.fechaInicio = { gte: start, lt: end };
    }
    const reservas = await reservaRepo.list(where);
    const ids = reservas.map((r) => r.id);
    const sums = ids.length
      ? await prisma.cobro.groupBy({ by: ['reservaId'], where: { reservaId: { in: ids } }, _sum: { monto: true } })
      : [];
    const pagadoPorId = new Map(sums.map((s) => [s.reservaId, Number(s._sum.monto ?? 0)]));
    return reservas.map((r) => {
      const pagado = pagadoPorId.get(r.id) ?? 0;
      const monto = Number(r.monto);
      return { ...r, pagado, saldo: Math.max(0, monto - pagado) };
    });
  },

  async aprobarSena(
    id: string,
    by: { adminId?: string; notificar?: boolean },
    detalle?: { montoDetectado?: number; comprobanteUrl?: string },
  ) {
    const r = await reservaService.get(id);
    assertTransition(r.estado, 'CONFIRMADA');
    const result = await prisma.$transaction(async (tx) => {
      await pagoRepo.upsertForReserva(
        id,
        {
          estado: 'APROBADO',
          verificadoPor: by.adminId ? 'HUMANO' : 'IA',
          aprobadoPorId: by.adminId ?? null,
          montoDetectado: detalle?.montoDetectado ?? null,
          comprobanteUrl: detalle?.comprobanteUrl ?? null,
        },
        tx,
      );
      const updated = await reservaRepo.confirmarSiEsperandoSena(id, tx);
      if (!updated) throw Conflict('La seña ya fue procesada');
      await auditLogRepo.record(
        { adminId: by.adminId ?? null, accion: 'APROBAR_SENA', entidad: 'Reserva', entidadId: id, descripcion: 'Aprobó la seña de una reserva' },
        tx,
      );
      const montoSena = Number(r.montoSena ?? 0);
      const detectado = detalle?.montoDetectado != null ? Number(detalle.montoDetectado) : null;
      // Si el comprobante detectó un monto MAYOR a la seña esperada (pagó de más), registrar el real; nunca menos.
      const montoCobro = detectado != null && detectado > montoSena ? detectado : montoSena;
      if (montoCobro > 0) {
        await cobroRepo.create(
          { reservaId: id, monto: montoCobro, medio: 'TRANSFERENCIA', origen: 'SENA', registradoPorId: by.adminId ?? null },
          tx,
        );
      }
      return updated;
    });
    sheetsSync.marcarSucio(ymdEnTz(r.fechaInicio));
    // Aviso al cliente en aprobación manual del admin O cuando el caller pide notificar
    // explícitamente (ej. webhook de Mercado Pago). El bot NO pasa notificar:true porque
    // ya avisa por su cuenta.
    // Fire-and-forget best-effort: todo el bloque va en try/catch para que el aviso NUNCA
    // pueda hacer fallar la aprobación (ni un throw síncrono al construir/enviar el mensaje).
    if (by.adminId || by.notificar) {
      try {
        const texto = mensajeSenaAprobada(r, getEnv().TZ_NEGOCIO);
        void evolutionService.enviarWhatsapp(r.cliente.whatsapp, texto).catch(() => {});
      } catch (e) {
        logger.warn({ err: e }, 'aviso de sena aprobada: fallo al construir/enviar el mensaje');
      }
    }
    return result;
  },

  async rechazarSena(id: string, by: { adminId?: string }) {
    const r = await reservaService.get(id);
    assertTransition(r.estado, 'CANCELADA');
    const result = await prisma.$transaction(async (tx) => {
      // Primero el update condicional: si perdió la carrera contra una aprobación, se corta
      // acá y no se escribe ni el pago rechazado ni la auditoría.
      const updated = await reservaRepo.cancelarSiEsperandoSena(id, tx);
      if (!updated) return null;
      await pagoRepo.upsertForReserva(
        id,
        {
          estado: 'RECHAZADO',
          verificadoPor: by.adminId ? 'HUMANO' : 'IA',
          aprobadoPorId: by.adminId ?? null,
        },
        tx,
      );
      await auditLogRepo.record(
        { adminId: by.adminId ?? null, accion: 'RECHAZAR_SENA', entidad: 'Reserva', entidadId: id, descripcion: 'Rechazó la seña de una reserva' },
        tx,
      );
      return updated;
    });
    if (result) sheetsSync.marcarSucio(ymdEnTz(r.fechaInicio));
    return result;
  },

  async cancelar(id: string, by: { adminId?: string }) {
    const r = await reservaService.get(id);
    assertTransition(r.estado, 'CANCELADA');
    const minutos = getEnv().CANCELACION_ANTICIPACION_MINUTOS;
    const limite = new Date(r.fechaInicio.getTime() - minutos * 60000);
    if (!by.adminId && Date.now() > limite.getTime()) {
      throw BusinessRule(`Solo se puede cancelar hasta ${minutos} minutos antes del turno`);
    }
    const cancelado = await prisma.$transaction(async (tx) => {
      const updated = await reservaRepo.updateEstado(id, 'CANCELADA', tx);
      await auditLogRepo.record(
        { adminId: by.adminId ?? null, accion: 'CANCELAR_RESERVA', entidad: 'Reserva', entidadId: id, descripcion: 'Canceló una reserva' },
        tx,
      );
      return updated;
    });
    sheetsSync.marcarSucio(ymdEnTz(r.fechaInicio));
    return cancelado;
  },

  async reprogramar(id: string, by: { adminId?: string }, input: { fecha: string; horaInicio: string; canchaId?: string }) {
    // NOTA: el monto NO se recalcula al reprogramar (mantiene precio/seña original), tampoco al cambiar de cancha.
    const r = await reservaService.get(id);
    if (r.estado !== 'CONFIRMADA' && r.estado !== 'ESPERANDO_SENA') {
      throw Conflict(`No se puede reprogramar una reserva ${r.estado}`);
    }
    const horas = getEnv().REPROGRAMACION_ANTICIPACION_HORAS;
    const limite = new Date(r.fechaInicio.getTime() - horas * 3600000);
    if (!by.adminId && Date.now() > limite.getTime()) {
      throw BusinessRule(`Solo se puede reprogramar hasta ${horas}h antes del turno`);
    }
    const tz = getEnv().TZ_NEGOCIO;
    const cfg = await configService.get();
    const duracionMs = r.fechaFin.getTime() - r.fechaInicio.getTime();

    // Mismo chequeo que `crear`: la reserva reprogramada tiene que terminar antes o justo en el
    // cierre. Sin esto, reprogramar una reserva larga a un horario tardío la desborda al día
    // siguiente sin que nada lo impida.
    const dowNuevo = dayOfWeekInTz(input.fecha, tz);
    const esFindeNuevo = dowNuevo === 0 || dowNuevo === 6;
    const aperturaNueva = esFindeNuevo ? cfg.horaAperturaFinde : cfg.horaApertura;
    const cierre = minutoDeJornada(esFindeNuevo ? cfg.horaCierreFinde : cfg.horaCierre, aperturaNueva);

    // En minutos de jornada: mismo tratamiento que en `crear` para que "00:00" caiga en el día
    // correcto y el cierre a la 01:00 lo siga admitiendo.
    const iniMin = minutoDeJornada(input.horaInicio, aperturaNueva);
    if (iniMin + duracionMs / 60000 > cierre) throw BusinessRule('La reserva termina después del horario de cierre');

    const nuevaInicio = instanteDeJornada(input.fecha, iniMin, tz);
    const nuevaFin = new Date(nuevaInicio.getTime() + duracionMs);
    if (nuevaInicio.getTime() <= Date.now()) {
      throw BusinessRule('No se puede reprogramar a un horario en el pasado');
    }

    // Mismo hueco que en `crear`: sin este chequeo, reprogramar es una puerta trasera a la
    // ventana de anticipación pública (crear una reserva cercana y después reprogramarla lejos).
    // El bot de n8n entra por acá con clave de servicio, así que queda tan limitado como el
    // público — solo el staff (`by.adminId`) puede mover una reserva fuera de la ventana.
    if (!by.adminId) {
      const { fin, ymd } = limiteAnticipacion(cfg, tz);
      if (nuevaInicio >= fin) {
        const [, mes, dia] = ymd.split('-');
        throw BusinessRule(`Por ahora solo se puede reservar hasta el ${dia}/${mes}`);
      }
    }

    // Cancha destino: la nueva si vino, o la misma. El cambio de cancha se valida contra el slot destino.
    const cambiaCancha = !!input.canchaId && input.canchaId !== r.canchaId;
    const canchaDestino = input.canchaId ?? r.canchaId;
    if (cambiaCancha) await canchaService.get(canchaDestino); // 404 si no existe

    const motivo = await ocupacionService.conflictoReserva(canchaDestino, input.fecha, iniMin, iniMin + duracionMs / 60000);
    if (motivo === 'fijo') throw Conflict('Ese horario está tomado por un turno fijo');
    if (motivo === 'bloqueo') throw Conflict('Ese horario está bloqueado');
    const reprogramado = await prisma.$transaction(async (tx) => {
      const updated = cambiaCancha
        ? await reservaRepo.moverDeCancha(id, canchaDestino, nuevaInicio, nuevaFin, r.estado, tx)
        : await reservaRepo.reprogramar(id, nuevaInicio, nuevaFin, tx);
      await auditLogRepo.record(
        { adminId: by.adminId ?? null, accion: 'REPROGRAMAR_RESERVA', entidad: 'Reserva', entidadId: id, descripcion: cambiaCancha ? 'Movió una reserva de cancha' : 'Reprogramó una reserva' },
        tx,
      );
      return updated;
    });
    sheetsSync.marcarSucio(ymdEnTz(r.fechaInicio));   // día viejo
    sheetsSync.marcarSucio(input.fecha);               // día nuevo
    return reprogramado;
  },

  misReservas: (whatsapp: string) =>
    reservaRepo.list({
      cliente: { whatsapp },
      estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA'] },
      fechaInicio: { gt: new Date() },
    }),

  async buscar(input: { nombre: string; fecha: string; cancha?: string; hora?: string }) {
    const tz = getEnv().TZ_NEGOCIO;
    // La agenda de un día es la de su JORNADA: el turno de las 00:00 pertenece al día anterior.
    // `caja`, `alquileres` y `analytics` NO usan esto — responden preguntas contables por día
    // calendario, y ahí la fecha del instante es la correcta.
    const cfg = await configService.get();
    const dow = dayOfWeekInTz(input.fecha, tz);
    const esFinde = dow === 0 || dow === 6;
    const { start, end } = jornadaWindowUtc(
      input.fecha, tz,
      esFinde ? cfg.horaAperturaFinde : cfg.horaApertura,
      esFinde ? cfg.horaCierreFinde : cfg.horaCierre,
    );
    const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const nq = norm(input.nombre);
    const cq = input.cancha ? norm(input.cancha) : null;
    const cnum = input.cancha ? ((input.cancha.match(/\d+/) || [])[0] || null) : null;
    const hhmm = (d: Date) => d.toLocaleTimeString('es-AR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const reservas = await prisma.reserva.findMany({
      where: { fechaInicio: { gte: start, lt: end }, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA'] } },
      include: { cliente: true, cancha: true },
      orderBy: { fechaInicio: 'asc' },
    });
    return reservas
      .filter((r) => nq && norm(r.cliente.nombre).includes(nq))
      .filter((r) => {
        if (!cq) return true;
        const cn = norm(r.cancha.nombre);
        return cn.includes(cq) || cq.includes(cn) || (!!cnum && ((cn.match(/\d+/) || [])[0] === cnum));
      })
      .filter((r) => !input.hora || hhmm(r.fechaInicio) === input.hora)
      .map((r) => ({
        id: r.id,
        cancha: { nombre: r.cancha.nombre },
        fecha: r.fechaInicio.toLocaleDateString('en-CA', { timeZone: tz }),
        horaInicio: hhmm(r.fechaInicio),
        estado: r.estado,
        clienteNombre: r.cliente.nombre,
      }));
  },

  vencidasSena: () => {
    const min = getEnv().SENA_TIMEOUT_MINUTOS;
    const limite = new Date(Date.now() - min * 60000);
    return reservaRepo.list({ estado: 'ESPERANDO_SENA', creadoEn: { lt: limite } });
  },
};
