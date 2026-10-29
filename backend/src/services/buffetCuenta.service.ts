import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';
import { BadRequest, BusinessRule, Conflict, NotFound } from '../utils/errors.js';
import { cajaAbierta } from './buffetCaja.service.js';
import { calcularPago, descontarStock, devolverStock, esViolacionStockAsignadoNegativo, mensajeSinStockAsignado, type MedioPago, type MostradorStock } from './buffetStock.js';

/**
 * Cuentas por cancha del buffet: se abre una al empezar el turno, se le van sumando consumos y al
 * final se rinde (ver `rendir`). El stock se mueve al sumar o quitar un consumo; rendir NO vuelve a
 * tocarlo. Cada mostrador maneja solo las cuentas que abrió: la de otro es un NotFound.
 */

export type EstadoCuenta = 'ABIERTA' | 'RENDIDA' | 'CANCELADA' | 'IMPAGA';
export interface CuentaLineaDTO { productoId: string; nombre: string; cantidad: number; precioUnit: number; subtotal: number }
export interface CuentaDTO {
  id: string; canchaId: string; canchaNombre: string; estado: EstadoCuenta;
  abiertaEn: string; cerradaEn: string | null;
  /** Cliente y horario de la reserva que estaba en curso al abrir la cuenta, si había. */
  reserva: { clienteNombre: string; horaInicio: string; horaFin: string } | null;
  total: number; lineas: CuentaLineaDTO[];
}

const MAX_CANTIDAD = 999;

/** Las cuentas por cancha son solo de pádel: en fútbol no se consume durante el turno. */
export const esCanchaDePadel = (tipo: string) => tipo.toLowerCase() === 'padel';

const incluir = {
  cancha: { select: { nombre: true } },
  reserva: { select: { fechaInicio: true, fechaFin: true, cliente: { select: { nombre: true } } } },
  lineas: { include: { producto: { select: { nombre: true } } }, orderBy: { id: 'asc' as const } },
} as const;

const hhmm = (d: Date) =>
  new Intl.DateTimeFormat('es-AR', { timeZone: getEnv().TZ_NEGOCIO, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

type CuentaConDatos = Awaited<ReturnType<typeof cargarSinDuenio>>;
const cargarSinDuenio = (id: string) => prisma.cuentaBuffet.findUnique({ where: { id }, include: incluir });

function aDTO(c: NonNullable<CuentaConDatos>): CuentaDTO {
  const lineas: CuentaLineaDTO[] = c.lineas.map((l) => ({
    productoId: l.productoId, nombre: l.producto.nombre, cantidad: l.cantidad,
    precioUnit: Number(l.precioUnit), subtotal: Number(l.precioUnit) * l.cantidad,
  }));
  return {
    id: c.id, canchaId: c.canchaId, canchaNombre: c.cancha.nombre, estado: c.estado,
    abiertaEn: c.abiertaEn.toISOString(), cerradaEn: c.cerradaEn ? c.cerradaEn.toISOString() : null,
    reserva: c.reserva ? { clienteNombre: c.reserva.cliente.nombre, horaInicio: hhmm(c.reserva.fechaInicio), horaFin: hhmm(c.reserva.fechaFin) } : null,
    // Una cuenta ya resuelta guarda su total congelado; una abierta (o cancelada) lo calcula de las líneas.
    total: c.total != null ? Number(c.total) : lineas.reduce((a, l) => a + l.subtotal, 0),
    lineas,
  };
}

async function mostradorDe(mostradorId: string): Promise<MostradorStock> {
  const m = await prisma.mostrador.findUnique({ where: { id: mostradorId } });
  if (!m) throw NotFound('Mostrador', mostradorId);
  return { id: m.id, tipo: m.tipo };
}

/** La cuenta, solo si es de ese mostrador (si es de otro, es como si no existiera). */
async function cargar(mostradorId: string, cuentaId: string) {
  const c = await prisma.cuentaBuffet.findFirst({ where: { id: cuentaId, mostradorId }, include: incluir });
  if (!c) throw NotFound('Cuenta', cuentaId);
  return c;
}

// El índice único parcial de la base (una cancha, una cuenta ABIERTA) es el que frena la carrera de
// dos aperturas simultáneas: Prisma lo reporta como P2002 o con el SQLSTATE 23505 en la causa.
const esViolacionUnica = (e: any) => e?.code === 'P2002' || e?.code === '23505' || e?.cause?.code === '23505';

export interface RendirInput { mostradorId: string; cuentaId: string; medioPago: MedioPago; montoPagado: number }
export interface RendirResultado { cuenta: CuentaDTO; ticketId: string; total: number; vuelto: number }

async function resultadoDeRendida(c: NonNullable<CuentaConDatos>): Promise<RendirResultado> {
  const t = await prisma.ticketBuffet.findUniqueOrThrow({ where: { id: c.ticketId! } });
  return { cuenta: aDTO(c), ticketId: t.id, total: Number(t.total), vuelto: Number(t.vuelto) };
}

export const buffetCuentaService = {
  async abrir(mostradorId: string, canchaId: string): Promise<CuentaDTO> {
    const cancha = await prisma.cancha.findUnique({ where: { id: canchaId } });
    if (!cancha) throw NotFound('Cancha', canchaId);
    if (!cancha.activa) throw BusinessRule('La cancha está desactivada');
    if (!esCanchaDePadel(cancha.tipo)) throw BusinessRule('Las cuentas por cancha son solo para pádel');
    const yaAbierta = await prisma.cuentaBuffet.findFirst({ where: { canchaId, estado: 'ABIERTA' } });
    if (yaAbierta) throw Conflict('Esa cancha ya tiene una cuenta abierta');

    const ahora = new Date();
    const reserva = await prisma.reserva.findFirst({
      where: { canchaId, estado: { in: ['CONFIRMADA', 'ESPERANDO_SENA', 'COMPLETADA'] }, fechaInicio: { lte: ahora }, fechaFin: { gt: ahora } },
      select: { id: true },
    });
    try {
      const c = await prisma.cuentaBuffet.create({ data: { mostradorId, canchaId, reservaId: reserva?.id ?? null }, include: incluir });
      return aDTO(c);
    } catch (e) {
      if (esViolacionUnica(e)) throw Conflict('Esa cancha ya tiene una cuenta abierta');
      throw e;
    }
  },

  async listarAbiertas(mostradorId: string): Promise<CuentaDTO[]> {
    const cuentas = await prisma.cuentaBuffet.findMany({ where: { mostradorId, estado: 'ABIERTA' }, include: incluir, orderBy: { abiertaEn: 'asc' } });
    return cuentas.map(aDTO);
  },

  /** Todas las cuentas de todos los mostradores, para el panel del admin (solo lectura). */
  async listarParaAdmin(estado?: EstadoCuenta): Promise<CuentaDTO[]> {
    const cuentas = await prisma.cuentaBuffet.findMany({ where: estado ? { estado } : {}, include: incluir, orderBy: { abiertaEn: 'desc' }, take: 200 });
    return cuentas.map(aDTO);
  },

  async detalle(mostradorId: string, cuentaId: string): Promise<CuentaDTO> {
    return aDTO(await cargar(mostradorId, cuentaId));
  },

  /**
   * Deja el consumo de un producto en `cantidad` (absoluta, no "sumar uno"): reintentar da el mismo
   * resultado. Descuenta o devuelve la diferencia de stock en la misma transacción. 0 quita la línea.
   */
  async fijarCantidad(mostradorId: string, cuentaId: string, productoId: string, cantidad: number): Promise<CuentaDTO> {
    if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > MAX_CANTIDAD) {
      throw BadRequest(`La cantidad tiene que ser un entero entre 0 y ${MAX_CANTIDAD}`);
    }
    const mostrador = await mostradorDe(mostradorId);
    let nombreEnCurso = 'ese producto';
    try {
      await prisma.$transaction(async (tx) => {
        const cuenta = await tx.cuentaBuffet.findFirst({ where: { id: cuentaId, mostradorId } });
        if (!cuenta) throw NotFound('Cuenta', cuentaId);
        if (cuenta.estado !== 'ABIERTA') throw Conflict('La cuenta no está abierta');

        const linea = await tx.cuentaBuffetLinea.findUnique({ where: { cuentaId_productoId: { cuentaId, productoId } } });
        const delta = cantidad - (linea?.cantidad ?? 0);
        if (delta === 0) return;

        if (delta > 0) {
          const producto = await tx.productoBuffet.findUnique({ where: { id: productoId } });
          if (!producto) throw NotFound('ProductoBuffet', productoId);
          if (!producto.activo) throw BusinessRule(`${producto.nombre} no está disponible`);
          nombreEnCurso = producto.nombre;
          await descontarStock(tx, mostrador, producto, delta);
          if (linea) await tx.cuentaBuffetLinea.update({ where: { id: linea.id }, data: { cantidad } });
          else await tx.cuentaBuffetLinea.create({ data: { cuentaId, productoId, precioUnit: producto.precio, cantidad } });
        } else {
          await devolverStock(tx, mostrador, productoId, -delta);
          if (cantidad === 0) await tx.cuentaBuffetLinea.delete({ where: { id: linea!.id } });
          else await tx.cuentaBuffetLinea.update({ where: { id: linea!.id }, data: { cantidad } });
        }
      });
    } catch (e) {
      // Si dos operaciones concurrentes dejaron el asignado en el límite, la base rechaza el
      // decremento con el CHECK: es el mismo caso de negocio que el pre-chequeo en código.
      if (esViolacionStockAsignadoNegativo(e)) throw BusinessRule(mensajeSinStockAsignado(nombreEnCurso));
      throw e;
    }
    return aDTO(await cargar(mostradorId, cuentaId));
  },

  /**
   * Cobra la cuenta de una vez: crea el ticket de venta en la caja abierta con los precios guardados
   * en las líneas. El stock ya se descontó al sumar cada consumo, así que acá NO se toca. Rendir de
   * nuevo una cuenta ya rendida devuelve el mismo ticket (un doble toque no cobra dos veces).
   */
  async rendir(input: RendirInput): Promise<RendirResultado> {
    const actual = await cargar(input.mostradorId, input.cuentaId);
    if (actual.estado === 'RENDIDA') return resultadoDeRendida(actual);
    if (actual.estado !== 'ABIERTA') throw Conflict('La cuenta ya se resolvió');
    if (actual.lineas.length === 0) throw BusinessRule('La cuenta está vacía: cancelala en vez de rendirla');
    const caja = await cajaAbierta(input.mostradorId);
    if (!caja) throw Conflict('No hay una caja abierta');

    const total = actual.lineas.reduce((a, l) => a + Number(l.precioUnit) * l.cantidad, 0);
    const { montoPagado, vuelto } = calcularPago(input.medioPago, input.montoPagado, total);

    await prisma.$transaction(async (tx) => {
      // Se reclama pasando de ABIERTA a RENDIDA: si dos pedidos llegan juntos, el segundo espera la
      // fila, ve count 0 y no crea otro ticket (abajo se relee el resultado del ganador).
      const r = await tx.cuentaBuffet.updateMany({
        where: { id: input.cuentaId, estado: 'ABIERTA' },
        data: { estado: 'RENDIDA', cerradaEn: new Date(), cajaId: caja.id, total },
      });
      if (r.count === 0) return;
      const ticket = await tx.ticketBuffet.create({
        data: { uid: `cuenta-${input.cuentaId}`, cajaId: caja.id, total, medioPago: input.medioPago, montoPagado, vuelto },
      });
      for (const l of actual.lineas) {
        await tx.ventaBuffet.create({ data: { ticketId: ticket.id, productoId: l.productoId, precioUnit: l.precioUnit, cantidad: l.cantidad } });
      }
      await tx.cuentaBuffet.update({ where: { id: input.cuentaId }, data: { ticketId: ticket.id } });
    });

    const final = await cargar(input.mostradorId, input.cuentaId);
    if (final.estado !== 'RENDIDA') throw Conflict('La cuenta ya se resolvió');
    return resultadoDeRendida(final);
  },

  /** Anula una cuenta abierta (error de carga): devuelve todo el stock y no genera ticket. */
  async cancelar(mostradorId: string, cuentaId: string): Promise<CuentaDTO> {
    const actual = await cargar(mostradorId, cuentaId);
    if (actual.estado === 'CANCELADA') return aDTO(actual);
    if (actual.estado !== 'ABIERTA') throw Conflict('La cuenta ya se resolvió');
    const mostrador = await mostradorDe(mostradorId);
    await prisma.$transaction(async (tx) => {
      // Se reclama pasando de ABIERTA a CANCELADA: si dos pedidos llegan juntos, uno solo devuelve el stock.
      const r = await tx.cuentaBuffet.updateMany({ where: { id: cuentaId, estado: 'ABIERTA' }, data: { estado: 'CANCELADA', cerradaEn: new Date() } });
      if (r.count === 0) return;
      for (const l of actual.lineas) await devolverStock(tx, mostrador, l.productoId, l.cantidad);
    });
    return aDTO(await cargar(mostradorId, cuentaId));
  },

  /** El grupo se fue sin pagar: la cuenta se cierra como impaga y el stock queda descontado (ya se consumió). */
  async darPorImpaga(mostradorId: string, cuentaId: string): Promise<CuentaDTO> {
    const actual = await cargar(mostradorId, cuentaId);
    if (actual.estado === 'IMPAGA') return aDTO(actual);
    if (actual.estado !== 'ABIERTA') throw Conflict('La cuenta ya se resolvió');
    const caja = await cajaAbierta(mostradorId);
    if (!caja) throw Conflict('No hay una caja abierta');
    const total = actual.lineas.reduce((a, l) => a + Number(l.precioUnit) * l.cantidad, 0);
    await prisma.cuentaBuffet.updateMany({
      where: { id: cuentaId, estado: 'ABIERTA' },
      data: { estado: 'IMPAGA', cerradaEn: new Date(), cajaId: caja.id, total },
    });
    return aDTO(await cargar(mostradorId, cuentaId));
  },
};
