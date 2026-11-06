import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';
import { dayWindowUtc, hoyEnTz, sumarDias } from '../utils/tz.js';

const SECUNDARIO = 'mostrador-secundario';

/**
 * Primer día en que el cupo del secundario se calcula con el modelo actual (entregar asigna, vender
 * baja, nada se devuelve solo). Antes, cada cierre se contaba y dejaba el asignado en cero fuera de
 * cualquier registro, así que reconstruir esos días hacia atrás daría números inventados.
 */
export const CUPO_SECUNDARIO_DESDE = '2026-11-05';

export interface LineaDiaSecundario {
  productoId: string; nombre: string;
  /** Lo que le había quedado del día anterior. */
  arranco: number;
  entregado: number;
  devuelto: number;
  vendido: number;
  quedo: number;
}
export interface DiaSecundario {
  fecha: string;
  lineas: LineaDiaSecundario[];
  totales: { arranco: number; entregado: number; devuelto: number; vendido: number; quedo: number };
}

const ymdEn = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

type Mov = { entregado: number; devuelto: number; vendido: number };

export const buffetSecundarioService = {
  /**
   * Día por día: con cuánto arrancó el secundario, cuánto se le entregó o devolvió, cuánto vendió y
   * cuánto le quedó.
   *
   * No hay un registro diario del cupo: se reconstruye hacia atrás desde lo que tiene HOY
   * (`StockMostrador`), deshaciendo cada día sus movimientos. Lo que cuenta como vendido es lo que
   * bajó el cupo: ventas de tickets (incluye las cuentas ya rendidas), cuentas impagas y cuentas
   * todavía abiertas (ya descontaron). Las canceladas devolvieron el stock, así que no cuentan.
   */
  async resumenDiario(opts: { dias?: number; desde?: string } = {}): Promise<DiaSecundario[]> {
    const tz = getEnv().TZ_NEGOCIO;
    const hoy = hoyEnTz(tz);
    const tope = opts.desde ?? CUPO_SECUNDARIO_DESDE;
    const dias = Math.max(1, Math.min(opts.dias ?? 14, 90));

    const fechas: string[] = []; // de hoy hacia atrás
    for (let i = 0; i < dias; i++) {
      const f = sumarDias(hoy, -i);
      if (f < tope) break;
      fechas.push(f);
    }
    if (fechas.length === 0) return [];

    const ini = dayWindowUtc(fechas[fechas.length - 1], tz).start;
    const fin = dayWindowUtc(hoy, tz).end;

    const [entregas, ventas, cuentas, actual] = await Promise.all([
      prisma.entregaMostradorLinea.findMany({
        where: { entrega: { mostradorId: SECUNDARIO, creadaEn: { gte: ini, lt: fin } } },
        include: { entrega: { select: { creadaEn: true } } },
      }),
      prisma.ventaBuffet.findMany({
        where: { creadoEn: { gte: ini, lt: fin }, ticket: { caja: { mostradorId: SECUNDARIO } } },
        select: { productoId: true, cantidad: true, creadoEn: true },
      }),
      prisma.cuentaBuffet.findMany({
        where: {
          mostradorId: SECUNDARIO,
          OR: [
            { estado: 'IMPAGA', cerradaEn: { gte: ini, lt: fin } },
            { estado: 'ABIERTA', abiertaEn: { gte: ini, lt: fin } },
          ],
        },
        include: { lineas: { select: { productoId: true, cantidad: true } } },
      }),
      prisma.stockMostrador.findMany({ where: { mostradorId: SECUNDARIO } }),
    ]);

    const porDia = new Map<string, Map<string, Mov>>();
    const mov = (fecha: string, productoId: string): Mov => {
      const dia = porDia.get(fecha) ?? new Map<string, Mov>();
      porDia.set(fecha, dia);
      const m = dia.get(productoId) ?? { entregado: 0, devuelto: 0, vendido: 0 };
      dia.set(productoId, m);
      return m;
    };
    for (const l of entregas) {
      const m = mov(ymdEn(l.entrega.creadaEn, tz), l.productoId);
      if (l.cantidad >= 0) m.entregado += l.cantidad; else m.devuelto += -l.cantidad;
    }
    for (const v of ventas) mov(ymdEn(v.creadoEn, tz), v.productoId).vendido += v.cantidad;
    for (const c of cuentas) {
      const cuando = c.estado === 'IMPAGA' ? (c.cerradaEn ?? c.abiertaEn) : c.abiertaEn;
      for (const l of c.lineas) mov(ymdEn(cuando, tz), l.productoId).vendido += l.cantidad;
    }

    // Cierre corriente por producto: arranca en lo que tiene hoy y se va deshaciendo día por día.
    const cierre = new Map<string, number>(actual.map((f) => [f.productoId, f.cantidad]));
    const ids = new Set<string>(cierre.keys());
    for (const dia of porDia.values()) for (const id of dia.keys()) ids.add(id);
    const nombres = new Map((await prisma.productoBuffet.findMany({ where: { id: { in: [...ids] } }, select: { id: true, nombre: true } })).map((p) => [p.id, p.nombre]));

    const salida: DiaSecundario[] = [];
    for (const fecha of fechas) {
      const delDia = porDia.get(fecha);
      const lineas: LineaDiaSecundario[] = [];
      for (const id of ids) {
        const m = delDia?.get(id) ?? { entregado: 0, devuelto: 0, vendido: 0 };
        const quedo = cierre.get(id) ?? 0;
        const arranco = quedo - m.entregado + m.devuelto + m.vendido;
        cierre.set(id, arranco);
        if (arranco || m.entregado || m.devuelto || m.vendido || quedo) {
          lineas.push({ productoId: id, nombre: nombres.get(id) ?? id, arranco, entregado: m.entregado, devuelto: m.devuelto, vendido: m.vendido, quedo });
        }
      }
      lineas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      const sumar = (k: keyof Omit<LineaDiaSecundario, 'productoId' | 'nombre'>) => lineas.reduce((a, l) => a + l[k], 0);
      salida.push({
        fecha, lineas,
        totales: { arranco: sumar('arranco'), entregado: sumar('entregado'), devuelto: sumar('devuelto'), vendido: sumar('vendido'), quedo: sumar('quedo') },
      });
    }
    return salida;
  },
};
