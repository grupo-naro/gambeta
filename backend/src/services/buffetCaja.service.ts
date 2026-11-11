import { prisma } from '../db/prisma.js';
import { Conflict, NotFound, BusinessRule } from '../utils/errors.js';

import { asegurarDelCatalogo, calcularPago, descontarStock, esViolacionStockAsignadoNegativo, mensajeSinStockAsignado } from './buffetStock.js';

type Medio = 'EFECTIVO' | 'TRANSFERENCIA';
export interface TicketLineaDTO { productoId: string; nombre: string; cantidad: number; precioUnit: number }
export interface TicketDTO { id: string; total: number; medioPago: Medio; vuelto: number; creadoEn: string; lineas: TicketLineaDTO[] }
export interface CajaEstado {
  id: string; abiertaEn: string;
  totalUnidades: number; totalMonto: number;
  totalEfectivo: number; totalTransferencia: number;
  /// Cuánto de `totalMonto` vino de alquileres. Aparte, para poder mirarlo solo.
  totalAlquileres: number;
  ultimosTickets: TicketDTO[];
}
export interface LineaCierre { productoId: string; nombre: string; unidades: number; monto: number }
export interface LineaCierreAlquiler { articuloId: string; nombre: string; unidades: number; monto: number }
export interface CierreDTO {
  id: string; abiertaEn: string; cerradaEn: string;
  totalUnidades: number; totalMonto: number; totalEfectivo: number; totalTransferencia: number;
  totalAlquileres: number;
  porProducto: LineaCierre[];
  porArticulo: LineaCierreAlquiler[];
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
  // Los alquileres son plata de esta caja igual que un ticket, así que suman al total y a su
  // medio de pago. `totalUnidades` NO se toca: cuenta productos de buffet y es lo que mira la
  // conciliación del secundario. Tampoco se filtra por estado: un alquiler devuelto o perdido
  // se cobró igual cuando salió.
  const alquileres = await prisma.alquiler.findMany({ where: { cajaId } });
  let totalAlquileres = 0;
  for (const a of alquileres) {
    const monto = Number(a.total);
    totalAlquileres += monto;
    totalMonto += monto;
    if (a.medioPago === 'EFECTIVO') totalEfectivo += monto; else totalTransferencia += monto;
  }
  return {
    id: caja.id, abiertaEn: caja.abiertaEn.toISOString(),
    totalUnidades, totalMonto, totalEfectivo, totalTransferencia,
    totalAlquileres,
    ultimosTickets: tickets.slice(0, 10).map((t) => ({
      id: t.id, total: Number(t.total), medioPago: t.medioPago as Medio, vuelto: Number(t.vuelto), creadoEn: t.creadoEn.toISOString(),
      lineas: t.lineas.map((l) => ({ productoId: l.productoId, nombre: l.producto.nombre, cantidad: l.cantidad, precioUnit: Number(l.precioUnit) })),
    })),
  };
}

// Exportada (no solo de uso interno): buffetConciliacion.service.ts la necesita para I4 —
// rechazar la conciliación de un cierre viejo mientras el secundario tiene otra caja ABIERTA —
// y repetir esta misma consulta ahí sería duplicarla en dos servicios.
export async function cajaAbierta(mostradorId: string) {
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
  const alquileres = await prisma.alquiler.findMany({
    where: { cajaId }, include: { articulo: { select: { nombre: true } } },
  });
  const porArticulo = new Map<string, LineaCierreAlquiler>();
  let totalAlquileres = 0;
  for (const a of alquileres) {
    const monto = Number(a.total);
    totalAlquileres += monto;
    totalMonto += monto;
    if (a.medioPago === 'EFECTIVO') totalEfectivo += monto; else totalTransferencia += monto;
    const cur = porArticulo.get(a.articuloId)
      ?? { articuloId: a.articuloId, nombre: a.articulo.nombre, unidades: 0, monto: 0 };
    cur.unidades += a.cantidad;
    cur.monto += monto;
    porArticulo.set(a.articuloId, cur);
  }
  return {
    id: caja.id, abiertaEn: caja.abiertaEn.toISOString(), cerradaEn: caja.cerradaEn.toISOString(),
    totalUnidades, totalMonto, totalEfectivo, totalTransferencia,
    totalAlquileres,
    porProducto: [...mapa.values()].sort((a, b) => b.monto - a.monto),
    porArticulo: [...porArticulo.values()].sort((a, b) => b.monto - a.monto),
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
    // El uid es único a nivel global (columna @unique), pero el aislamiento entre mostradores
    // que introduce esta task exige que un ticket previo solo se reutilice si es del MISMO
    // mostrador: si no, un uid repetido por otro puesto devolvería el estado de caja ajeno
    // (totales y últimos tickets de otro mostrador) y la venta real se perdería en silencio.
    const previo = await prisma.ticketBuffet.findUnique({ where: { uid: input.uid }, include: { caja: { select: { mostradorId: true } } } });
    if (previo) {
      if (previo.caja.mostradorId !== input.mostradorId) {
        throw Conflict(`El uid "${input.uid}" ya se usó en otro mostrador`);
      }
      return { ticketId: previo.id, total: Number(previo.total), vuelto: Number(previo.vuelto), medioPago: previo.medioPago as Medio, caja: await estadoDe(previo.cajaId) };
    }

    const caja = await cajaAbierta(input.mostradorId);
    if (!caja) throw Conflict('No hay una caja abierta');
    if (!input.items.length) throw BusinessRule('El carrito está vacío');

    const mostrador = await prisma.mostrador.findUnique({ where: { id: input.mostradorId } });
    if (!mostrador) throw NotFound('Mostrador', input.mostradorId);

    const ids = input.items.map((i) => i.productoId);
    const productos = await prisma.productoBuffet.findMany({ where: { id: { in: ids }, activo: true } });
    const byId = new Map(productos.map((p) => [p.id, p]));
    for (const it of input.items) {
      if (!byId.has(it.productoId)) throw NotFound('ProductoBuffet', it.productoId);
      if (it.cantidad < 1) throw BusinessRule('Cantidad inválida');
      asegurarDelCatalogo({ id: input.mostradorId, tipo: mostrador.tipo }, byId.get(it.productoId)!);
    }
    const total = input.items.reduce((a, it) => a + Number(byId.get(it.productoId)!.precio) * it.cantidad, 0);

    const { montoPagado, vuelto } = calcularPago(input.medioPago, input.montoPagado, total);

    let ticketId = '';
    // Si la carrera la gana la restricción CHECK de la base (ver esViolacionStockAsignadoNegativo
    // más abajo) en vez del pre-chequeo en código, este es el producto sobre el que se estaba
    // decrementando cuando explotó — lo necesitamos para armar el mismo mensaje de negocio.
    let productoEnCurso: { nombre: string } | undefined;
    try {
      await prisma.$transaction(async (tx) => {
        const ticket = await tx.ticketBuffet.create({ data: { uid: input.uid, cajaId: caja.id, total, medioPago: input.medioPago, montoPagado, vuelto } });
        ticketId = ticket.id;
        for (const it of input.items) {
          const p = byId.get(it.productoId)!;
          await tx.ventaBuffet.create({ data: { ticketId: ticket.id, productoId: p.id, precioUnit: p.precio, cantidad: it.cantidad } });

          productoEnCurso = p;
          await descontarStock(tx, { id: input.mostradorId, tipo: mostrador.tipo }, p, it.cantidad);
        }
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        // Mismo aislamiento que el chequeo de arriba (líneas ~104-110), pero acá para la rama
        // concurrente: si dos mostradores mandan el mismo uid a la vez, ambos pueden ver `null`
        // en el findUnique inicial y entrar los dos a la transacción; el que pierde la carrera
        // del índice único cae en este catch. Sin este chequeo, se le devolvería el ticket y la
        // caja del OTRO mostrador como si su propia venta hubiera salido bien.
        const ya = await prisma.ticketBuffet.findUnique({ where: { uid: input.uid }, include: { caja: { select: { mostradorId: true } } } });
        if (ya) {
          if (ya.caja.mostradorId !== input.mostradorId) {
            throw Conflict(`El uid "${input.uid}" ya se usó en otro mostrador`);
          }
          return { ticketId: ya.id, total: Number(ya.total), vuelto: Number(ya.vuelto), medioPago: ya.medioPago as Medio, caja: await estadoDe(ya.cajaId) };
        }
      }
      // La otra transacción concurrente ganó la carrera y dejó el asignado en el límite: el
      // decrement de esta transacción lo llevaría a negativo y la base lo rechaza con el CHECK.
      // Es el mismo caso de negocio que el pre-chequeo de arriba, solo que descubierto por la
      // base en vez de por el código — así que es el mismo BusinessRule, no un 500.
      if (esViolacionStockAsignadoNegativo(e)) {
        throw BusinessRule(mensajeSinStockAsignado(productoEnCurso?.nombre ?? 'ese producto'));
      }
      throw e;
    }
    return { ticketId, total, vuelto, medioPago: input.medioPago, caja: await estadoDe(caja.id) };
  },

  async cerrar(mostradorId: string): Promise<CierreDTO> {
    const caja = await cajaAbierta(mostradorId);
    if (!caja) throw Conflict('No hay una caja abierta');
    // Un consumo sin cobrar se perdería en silencio y descuadraría el conteo del cierre.
    const abiertas = await prisma.cuentaBuffet.count({ where: { mostradorId, estado: 'ABIERTA' } });
    if (abiertas > 0) {
      throw Conflict(`Hay ${abiertas} cuenta${abiertas === 1 ? '' : 's'} abierta${abiertas === 1 ? '' : 's'}: rendila, cancelala o marcala como impaga antes de cerrar la caja`);
    }
    const est = await estadoDe(caja.id);
    await prisma.cajaBuffet.update({
      where: { id: caja.id },
      data: {
        estado: 'CERRADA', cerradaEn: new Date(),
        totalUnidades: est.totalUnidades,
        // `est.totalMonto` ya incluye los alquileres (Step 4), y esta columna NO puede
        // incluirlos: significa "lo que vendió el buffet" en todos los cierres ya guardados y
        // tiene que seguir significando eso. Por eso se resta.
        totalMonto: est.totalMonto - est.totalAlquileres,
        totalAlquileres: est.totalAlquileres,
      },
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
