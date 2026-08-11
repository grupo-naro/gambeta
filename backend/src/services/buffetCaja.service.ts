import { prisma } from '../db/prisma.js';
import { Conflict, NotFound, BusinessRule } from '../utils/errors.js';

type Medio = 'EFECTIVO' | 'TRANSFERENCIA';
export interface TicketLineaDTO { productoId: string; nombre: string; cantidad: number; precioUnit: number }
export interface TicketDTO { id: string; total: number; medioPago: Medio; vuelto: number; creadoEn: string; lineas: TicketLineaDTO[] }
export interface CajaEstado {
  id: string; abiertaEn: string;
  totalUnidades: number; totalMonto: number;
  totalEfectivo: number; totalTransferencia: number;
  ultimosTickets: TicketDTO[];
}
export interface LineaCierre { productoId: string; nombre: string; unidades: number; monto: number }
export interface CierreDTO {
  id: string; abiertaEn: string; cerradaEn: string;
  totalUnidades: number; totalMonto: number; totalEfectivo: number; totalTransferencia: number;
  porProducto: LineaCierre[];
}
export interface CobrarInput { mostradorId: string; uid: string; medioPago: Medio; montoPagado: number; items: { productoId: string; cantidad: number }[] }
export interface CobroResultado { ticketId: string; total: number; vuelto: number; medioPago: Medio; caja: CajaEstado }

const ticketConLineas = { lineas: { include: { producto: { select: { nombre: true } } } } } as const;

async function estadoDe(cajaId: string): Promise<CajaEstado> {
  const caja = await prisma.cajaBuffet.findUniqueOrThrow({ where: { id: cajaId } });
  const tickets = await prisma.ticketBuffet.findMany({ where: { cajaId }, include: ticketConLineas, orderBy: { creadoEn: 'desc' } });
  let totalMonto = 0, totalUnidades = 0, totalEfectivo = 0, totalTransferencia = 0;
  for (const t of tickets) {
    totalMonto += Number(t.total);
    for (const l of t.lineas) totalUnidades += l.cantidad;
    if (t.medioPago === 'EFECTIVO') totalEfectivo += Number(t.total); else totalTransferencia += Number(t.total);
  }
  return {
    id: caja.id, abiertaEn: caja.abiertaEn.toISOString(),
    totalUnidades, totalMonto, totalEfectivo, totalTransferencia,
    ultimosTickets: tickets.slice(0, 10).map((t) => ({
      id: t.id, total: Number(t.total), medioPago: t.medioPago as Medio, vuelto: Number(t.vuelto), creadoEn: t.creadoEn.toISOString(),
      lineas: t.lineas.map((l) => ({ productoId: l.productoId, nombre: l.producto.nombre, cantidad: l.cantidad, precioUnit: Number(l.precioUnit) })),
    })),
  };
}

async function cajaAbierta(mostradorId: string) {
  return prisma.cajaBuffet.findFirst({ where: { estado: 'ABIERTA', mostradorId } });
}

async function detalleCierre(cajaId: string): Promise<CierreDTO | null> {
  const caja = await prisma.cajaBuffet.findUnique({ where: { id: cajaId } });
  if (!caja || !caja.cerradaEn) return null;
  const tickets = await prisma.ticketBuffet.findMany({ where: { cajaId }, include: ticketConLineas });
  const mapa = new Map<string, LineaCierre>();
  let totalUnidades = 0, totalMonto = 0, totalEfectivo = 0, totalTransferencia = 0;
  for (const t of tickets) {
    totalMonto += Number(t.total);
    if (t.medioPago === 'EFECTIVO') totalEfectivo += Number(t.total); else totalTransferencia += Number(t.total);
    for (const l of t.lineas) {
      totalUnidades += l.cantidad;
      const cur = mapa.get(l.productoId) ?? { productoId: l.productoId, nombre: l.producto.nombre, unidades: 0, monto: 0 };
      cur.unidades += l.cantidad;
      cur.monto += Number(l.precioUnit) * l.cantidad;
      mapa.set(l.productoId, cur);
    }
  }
  return {
    id: caja.id, abiertaEn: caja.abiertaEn.toISOString(), cerradaEn: caja.cerradaEn.toISOString(),
    totalUnidades, totalMonto, totalEfectivo, totalTransferencia,
    porProducto: [...mapa.values()].sort((a, b) => b.monto - a.monto),
  };
}

export const buffetCajaService = {
  async abrir(mostradorId: string): Promise<CajaEstado> {
    const ya = await cajaAbierta(mostradorId);
    if (ya) return estadoDe(ya.id);
    try {
      const creada = await prisma.cajaBuffet.create({ data: { mostradorId } });
      return estadoDe(creada.id);
    } catch (e: any) {
      if (e?.code === 'P2002') { const ex = await cajaAbierta(mostradorId); if (ex) return estadoDe(ex.id); }
      throw e;
    }
  },

  async actual(mostradorId: string): Promise<CajaEstado | null> {
    const c = await cajaAbierta(mostradorId);
    return c ? estadoDe(c.id) : null;
  },

  async cobrar(input: CobrarInput): Promise<CobroResultado> {
    const previo = await prisma.ticketBuffet.findUnique({ where: { uid: input.uid } });
    if (previo) return { ticketId: previo.id, total: Number(previo.total), vuelto: Number(previo.vuelto), medioPago: previo.medioPago as Medio, caja: await estadoDe(previo.cajaId) };

    const caja = await cajaAbierta(input.mostradorId);
    if (!caja) throw Conflict('No hay una caja abierta');
    if (!input.items.length) throw BusinessRule('El carrito está vacío');

    const mostrador = await prisma.mostrador.findUniqueOrThrow({ where: { id: input.mostradorId } });
    const esSecundario = mostrador.tipo === 'SECUNDARIO';

    const ids = input.items.map((i) => i.productoId);
    const productos = await prisma.productoBuffet.findMany({ where: { id: { in: ids }, activo: true } });
    const byId = new Map(productos.map((p) => [p.id, p]));
    for (const it of input.items) {
      if (!byId.has(it.productoId)) throw NotFound('ProductoBuffet', it.productoId);
      if (it.cantidad < 1) throw BusinessRule('Cantidad inválida');
    }
    const total = input.items.reduce((a, it) => a + Number(byId.get(it.productoId)!.precio) * it.cantidad, 0);

    let montoPagado: number; let vuelto: number;
    if (input.medioPago === 'EFECTIVO') {
      if (input.montoPagado < total) throw BusinessRule('El monto pagado es menor al total');
      montoPagado = input.montoPagado; vuelto = montoPagado - total;
    } else { montoPagado = total; vuelto = 0; }

    let ticketId = '';
    try {
      await prisma.$transaction(async (tx) => {
        const ticket = await tx.ticketBuffet.create({ data: { uid: input.uid, cajaId: caja.id, total, medioPago: input.medioPago, montoPagado, vuelto } });
        ticketId = ticket.id;
        for (const it of input.items) {
          const p = byId.get(it.productoId)!;
          await tx.ventaBuffet.create({ data: { ticketId: ticket.id, productoId: p.id, precioUnit: p.precio, cantidad: it.cantidad } });

          // El principal vende contra el stock general; el secundario, contra lo que se le
          // asignó. Descontar del general una venta del secundario contaría dos veces la misma
          // unidad: ya había salido del general cuando se la entregaron.
          if (esSecundario) {
            const asignado = await tx.stockMostrador.findUnique({
              where: { mostradorId_productoId: { mostradorId: input.mostradorId, productoId: p.id } },
            });
            if (!asignado || asignado.cantidad < it.cantidad) {
              throw BusinessRule(`No tenés stock asignado de ${p.nombre}. Pedile al mostrador principal que te entregue.`);
            }
            await tx.stockMostrador.update({
              where: { mostradorId_productoId: { mostradorId: input.mostradorId, productoId: p.id } },
              data: { cantidad: { decrement: it.cantidad } },
            });
          } else {
            await tx.productoBuffet.update({ where: { id: p.id }, data: { stock: { decrement: it.cantidad } } });
          }
        }
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const ya = await prisma.ticketBuffet.findUnique({ where: { uid: input.uid } });
        if (ya) return { ticketId: ya.id, total: Number(ya.total), vuelto: Number(ya.vuelto), medioPago: ya.medioPago as Medio, caja: await estadoDe(ya.cajaId) };
      }
      throw e;
    }
    return { ticketId, total, vuelto, medioPago: input.medioPago, caja: await estadoDe(caja.id) };
  },

  async cerrar(mostradorId: string): Promise<CierreDTO> {
    const caja = await cajaAbierta(mostradorId);
    if (!caja) throw Conflict('No hay una caja abierta');
    const est = await estadoDe(caja.id);
    await prisma.cajaBuffet.update({
      where: { id: caja.id },
      data: { estado: 'CERRADA', cerradaEn: new Date(), totalUnidades: est.totalUnidades, totalMonto: est.totalMonto },
    });
    return (await detalleCierre(caja.id))!;
  },

  async listCierres(mostradorId?: string): Promise<CierreDTO[]> {
    const cajas = await prisma.cajaBuffet.findMany({ where: { estado: 'CERRADA', ...(mostradorId ? { mostradorId } : {}) }, orderBy: { cerradaEn: 'desc' } });
    const out: CierreDTO[] = [];
    for (const c of cajas) { const d = await detalleCierre(c.id); if (d) out.push(d); }
    return out;
  },
};
