import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';
import { configService } from './config.service.js';
import { fijoVigenteEn } from './turnoFijo.vigencia.js';
import { dayOfWeekInTz, instanteDeJornada, jornadaWindowUtc, minutoDeJornada, sumarDias } from '../utils/tz.js';

const ACTIVE = ['CONFIRMADA', 'COMPLETADA'] as const;

const MOSTRADORES = ['PRINCIPAL', 'SECUNDARIO'] as const;
type TipoMostrador = (typeof MOSTRADORES)[number];
const NOMBRE_MOSTRADOR: Record<TipoMostrador, string> = { PRINCIPAL: 'Mostrador principal', SECUNDARIO: 'Mostrador secundario' };
const redondear = (n: number) => Math.round(n * 100) / 100;

export const analyticsService = {
  async ingresos(desde: Date, hasta: Date) {
    const agg = await prisma.reserva.aggregate({
      _sum: { monto: true },
      where: { estado: { in: [...ACTIVE] }, fechaInicio: { gte: desde, lt: hasta } },
    });
    return { total: agg._sum.monto ?? 0 };
  },

  /**
   * Cuántos turnos SE USARON en el período, y de qué tipo. Es la base del balance semanal / mensual.
   *
   * Un turno cuenta recién cuando TERMINA (`fechaFin` ya pasó): una confirmada de esta noche todavía
   * no se jugó y se informa aparte como `proximas`. Las canceladas y las que esperaban seña no son
   * turnos jugados: van por separado (`canceladas`, `esperandoSena`).
   *
   * Los abonos se suman a medida que pasan, aunque nadie los haya cobrado ese día: un turno fijo
   * solo se convierte en reserva cuando se cobra, así que además de las reservas se cuentan las
   * ocurrencias pasadas de cada fijo activo (respetando su período, las fechas liberadas y que
   * recién cuentan desde que se cargó el fijo, o desde el inicio de su período si lo tiene) que
   * todavía no tienen reserva. Si el abono se cobró, se cuenta una sola vez, por su reserva.
   *
   * Origen: abono si viene de un turno fijo, socio si es de una suscripción, suelta en cualquier
   * otro caso. Deporte: pádel si el tipo de cancha es "padel", fútbol en cualquier otro caso.
   */
  async reservas(desde: Date, hasta: Date, opts: { desdeYmd: string; hastaYmd: string; ahora?: Date }) {
    const tz = getEnv().TZ_NEGOCIO;
    const ahora = opts.ahora ?? new Date();
    const out = {
      total: 0, proximas: 0, canceladas: 0, esperandoSena: 0,
      porDeporte: { futbol: 0, padel: 0 },
      porOrigen: { sueltas: 0, abonos: 0, socios: 0 },
    };
    const contar = (tipoCancha: string, origen: 'sueltas' | 'abonos' | 'socios') => {
      out.total++;
      if (tipoCancha.toLowerCase() === 'padel') out.porDeporte.padel++; else out.porDeporte.futbol++;
      out.porOrigen[origen]++;
    };

    const rows = await prisma.reserva.findMany({
      where: { fechaInicio: { gte: desde, lt: hasta } },
      select: { estado: true, fechaFin: true, turnoFijoId: true, suscripcionId: true, cancha: { select: { tipo: true } } },
    });
    for (const r of rows) {
      if (r.estado === 'CANCELADA') { out.canceladas++; continue; }
      if (r.estado === 'ESPERANDO_SENA') { out.esperandoSena++; continue; }
      if (r.estado === 'CONFIRMADA' && r.fechaFin > ahora) { out.proximas++; continue; }
      contar(r.cancha.tipo, r.turnoFijoId ? 'abonos' : r.suscripcionId ? 'socios' : 'sueltas');
    }

    // Abonos que pasaron sin que nadie los cobrara (no tienen reserva).
    const fechas: string[] = [];
    for (let f = opts.desdeYmd; f <= opts.hastaYmd && fechas.length < 120; f = sumarDias(f, 1)) fechas.push(f);
    if (fechas.length === 0) return out;

    const cfg = await configService.get();
    const jornada = (fecha: string) => {
      const dia = dayOfWeekInTz(fecha, tz);
      const finde = dia === 0 || dia === 6;
      const apertura = finde ? cfg.horaAperturaFinde : cfg.horaApertura;
      const cierre = finde ? cfg.horaCierreFinde : cfg.horaCierre;
      return { dia, apertura, ...jornadaWindowUtc(fecha, tz, apertura, cierre) };
    };
    const jornadas = new Map(fechas.map((f) => [f, jornada(f)]));
    const inicio = jornadas.get(fechas[0])!.start;
    const fin = jornadas.get(fechas[fechas.length - 1])!.end;

    const [fijos, conReserva] = await Promise.all([
      prisma.turnoFijo.findMany({
        where: { activo: true },
        include: {
          cancha: { select: { tipo: true } },
          excepciones: { where: { fecha: { gte: new Date(opts.desdeYmd + 'T00:00:00.000Z'), lte: new Date(opts.hastaYmd + 'T00:00:00.000Z') } } },
        },
      }),
      // Cualquier estado: una reserva cancelada del fijo también ocupa esa fecha (no se cuenta como usada).
      prisma.reserva.findMany({ where: { turnoFijoId: { not: null }, fechaInicio: { gte: inicio, lt: fin } }, select: { turnoFijoId: true, fechaInicio: true } }),
    ]);
    const materializado = new Set<string>();
    for (const r of conReserva) {
      for (const [fecha, j] of jornadas) if (r.fechaInicio >= j.start && r.fechaInicio < j.end) materializado.add(`${r.turnoFijoId}|${fecha}`);
    }
    const ymdDe = (d: Date) => d.toISOString().slice(0, 10);
    const ymdEnTz = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    for (const f of fijos) {
      const liberadas = new Set(f.excepciones.map((e) => ymdDe(e.fecha)));
      const desdeFijo = f.vigenciaDesde ? ymdDe(f.vigenciaDesde) : ymdEnTz(f.creadoEn);
      for (const fecha of fechas) {
        const j = jornadas.get(fecha)!;
        if (j.dia !== f.diaSemana || fecha < desdeFijo) continue;
        if (liberadas.has(fecha) || !fijoVigenteEn(f, fecha) || materializado.has(`${f.id}|${fecha}`)) continue;
        // Termina cuando termina su horario, no cuando empieza (cierre a medianoche = fin del día).
        if (instanteDeJornada(fecha, minutoDeJornada(f.horaFin, j.apertura), tz) > ahora) continue;
        contar(f.cancha.tipo, 'abonos');
      }
    }
    return out;
  },

  async canchasTop(desde: Date, hasta: Date) {
    const rows = await prisma.reserva.groupBy({
      by: ['canchaId'],
      where: { estado: { in: [...ACTIVE] }, fechaInicio: { gte: desde, lt: hasta } },
      _count: { canchaId: true },
      orderBy: { _count: { canchaId: 'desc' } },
    });
    return rows.map((r) => ({ canchaId: r.canchaId, reservas: r._count.canchaId }));
  },

  
  horariosPico(desde: Date, hasta: Date) {
    return prisma.$queryRaw<Array<{ hora: number; reservas: bigint }>>`
      SELECT EXTRACT(HOUR FROM "fechaInicio")::int AS hora, COUNT(*) AS reservas
      FROM "Reserva"
      WHERE estado IN ('CONFIRMADA','COMPLETADA') AND "fechaInicio" >= ${desde} AND "fechaInicio" < ${hasta}
      GROUP BY 1 ORDER BY reservas DESC`;
  },

  ocupacion(desde: Date, hasta: Date) {
    return prisma.$queryRaw<Array<{ dia: number; hora: number; reservas: bigint }>>`
      SELECT EXTRACT(DOW FROM "fechaInicio")::int AS dia, EXTRACT(HOUR FROM "fechaInicio")::int AS hora, COUNT(*) AS reservas
      FROM "Reserva"
      WHERE estado IN ('CONFIRMADA','COMPLETADA') AND "fechaInicio" >= ${desde} AND "fechaInicio" < ${hasta}
      GROUP BY 1,2 ORDER BY dia, hora`;
  },

  /**
   * Ventas del buffet en el período, separadas por mostrador (el buffet tiene dos puestos, principal y
   * secundario, cada uno con su caja). Siempre devuelve los dos, aunque no hayan vendido. Las ventas
   * son los tickets; los alquileres (pecheras, etc.) van aparte porque no son venta de buffet. El día
   * de cada ticket es el de la hora argentina en que se vendió. `dias` trae TODOS los días del rango
   * (también los sin ventas), el más nuevo primero, con el desglose por medio de pago, por mostrador y
   * por producto.
   */
  async buffet(desde: Date, hasta: Date, rango: { desdeYmd: string; hastaYmd: string }) {
    const tz = getEnv().TZ_NEGOCIO;
    const diaEnTz = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    const [tickets, alquileres, filas] = await Promise.all([
      prisma.ticketBuffet.findMany({
        where: { creadoEn: { gte: desde, lt: hasta } },
        select: {
          total: true, medioPago: true, creadoEn: true,
          caja: { select: { mostrador: { select: { tipo: true } } } },
          lineas: { select: { cantidad: true, precioUnit: true, producto: { select: { id: true, nombre: true } } } },
        },
      }),
      prisma.alquiler.findMany({
        where: { entregadoEn: { gte: desde, lt: hasta } },
        select: { total: true, caja: { select: { mostrador: { select: { tipo: true } } } } },
      }),
      prisma.mostrador.findMany({ select: { tipo: true, nombre: true } }),
    ]);
    const nombres = new Map(filas.map((m) => [m.tipo as TipoMostrador, m.nombre]));

    type Prod = Map<string, { nombre: string; unidades: number; monto: number }>;
    const sumarProducto = (m: Prod, id: string, nombre: string, unidades: number, monto: number) => {
      const p = m.get(id) ?? { nombre, unidades: 0, monto: 0 };
      p.unidades += unidades; p.monto += monto; m.set(id, p);
    };
    const porUnidades = (m: Prod) => [...m.values()].sort((x, y) => y.unidades - x.unidades || y.monto - x.monto || x.nombre.localeCompare(y.nombre));

    const acc = Object.fromEntries(MOSTRADORES.map((t) => [t, {
      monto: 0, tickets: 0, unidades: 0, alquileres: 0,
      porMedio: { EFECTIVO: 0, TRANSFERENCIA: 0 },
      productos: new Map() as Prod,
    }]));
    type Acc = (typeof acc)[TipoMostrador];
    const dias = new Map<string, {
      unidades: number; efectivo: number; transferencia: number; total: number;
      mostradores: Record<TipoMostrador, { unidades: number; total: number }>; productos: Prod;
    }>();
    const productosTotal: Prod = new Map();
    const diaDe = (fecha: string) => {
      let d = dias.get(fecha);
      if (!d) { d = { unidades: 0, efectivo: 0, transferencia: 0, total: 0, mostradores: { PRINCIPAL: { unidades: 0, total: 0 }, SECUNDARIO: { unidades: 0, total: 0 } }, productos: new Map() }; dias.set(fecha, d); }
      return d;
    };

    for (const t of tickets) {
      const tipo = t.caja.mostrador.tipo as TipoMostrador;
      const a: Acc = acc[tipo];
      const total = Number(t.total);
      a.monto += total; a.tickets += 1; a.porMedio[t.medioPago] += total;
      const d = diaDe(diaEnTz.format(t.creadoEn));
      d.total += total;
      d.mostradores[tipo].total += total;
      if (t.medioPago === 'EFECTIVO') d.efectivo += total; else d.transferencia += total;
      for (const l of t.lineas) {
        const monto = Number(l.precioUnit) * l.cantidad;
        a.unidades += l.cantidad;
        d.unidades += l.cantidad; d.mostradores[tipo].unidades += l.cantidad;
        sumarProducto(a.productos, l.producto.id, l.producto.nombre, l.cantidad, monto);
        sumarProducto(d.productos, l.producto.id, l.producto.nombre, l.cantidad, monto);
        sumarProducto(productosTotal, l.producto.id, l.producto.nombre, l.cantidad, monto);
      }
    }
    for (const al of alquileres) acc[al.caja.mostrador.tipo as TipoMostrador].alquileres += Number(al.total);

    const mostradores = MOSTRADORES.map((tipo) => {
      const a = acc[tipo];
      return {
        tipo, nombre: nombres.get(tipo) ?? NOMBRE_MOSTRADOR[tipo],
        monto: a.monto, tickets: a.tickets, unidades: a.unidades,
        ticketPromedio: a.tickets ? redondear(a.monto / a.tickets) : 0,
        alquileres: a.alquileres, porMedio: a.porMedio,
        topProductos: porUnidades(a.productos).slice(0, 5),
      };
    });
    const sum = (fn: (m: (typeof mostradores)[number]) => number) => mostradores.reduce((s, m) => s + fn(m), 0);
    const monto = sum((m) => m.monto);
    const nTickets = sum((m) => m.tickets);
    const top = porUnidades(productosTotal)[0];

    // Todos los días del rango, también los sin ventas, el más nuevo primero.
    const lista = [];
    for (let fecha = rango.hastaYmd; fecha >= rango.desdeYmd; fecha = sumarDias(fecha, -1)) {
      const d = dias.get(fecha) ?? diaDe(fecha);
      lista.push({ fecha, unidades: d.unidades, efectivo: d.efectivo, transferencia: d.transferencia, total: d.total, mostradores: d.mostradores, productos: porUnidades(d.productos) });
    }

    return {
      total: {
        monto, tickets: nTickets, unidades: sum((m) => m.unidades),
        ticketPromedio: nTickets ? redondear(monto / nTickets) : 0,
        alquileres: sum((m) => m.alquileres),
        porMedio: { EFECTIVO: sum((m) => m.porMedio.EFECTIVO), TRANSFERENCIA: sum((m) => m.porMedio.TRANSFERENCIA) },
        masVendido: top ? { nombre: top.nombre, unidades: top.unidades } : null,
      },
      mostradores,
      dias: lista,
    };
  },

  ingresosPorDia(desde: Date, hasta: Date) {
    return prisma.$queryRaw<Array<{ fecha: string; total: number }>>`
      SELECT to_char(("fechaInicio" AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 'YYYY-MM-DD') AS fecha,
             SUM("monto")::float8 AS total
      FROM "Reserva"
      WHERE estado IN ('CONFIRMADA','COMPLETADA') AND "fechaInicio" >= ${desde} AND "fechaInicio" < ${hasta}
      GROUP BY 1 ORDER BY 1`;
  },

  // Tres consultas y no una: `COUNT(DISTINCT visitanteId)` no se puede derivar sumando los
  // subtotales (el mismo visitante puede aparecer en dos filas), así que cada nivel de
  // agregación tiene que contar sus propios únicos.
  async origenes(desde: Date, hasta: Date) {
    const [totales, porTipo, porEtiqueta] = await Promise.all([
      prisma.$queryRaw<Array<{ visitas: bigint; unicos: bigint }>>`
        SELECT COUNT(*) AS visitas, COUNT(DISTINCT "visitanteId") AS unicos
        FROM "Visita"
        WHERE "creadoEn" >= ${desde} AND "creadoEn" < ${hasta}`,
      prisma.$queryRaw<Array<{ tipo: string; visitas: bigint; unicos: bigint }>>`
        SELECT tipo::text AS tipo, COUNT(*) AS visitas, COUNT(DISTINCT "visitanteId") AS unicos
        FROM "Visita"
        WHERE "creadoEn" >= ${desde} AND "creadoEn" < ${hasta}
        GROUP BY 1 ORDER BY visitas DESC`,
      // `etiqueta` no tiene allowlist (es deliberado: así un QR nuevo no toca código), así que
      // alguien paseando por /r/aaa, /r/aab... podría generar miles de filas acá. LIMIT 50
      // corta esa cola sin afectar el resultado real: ya viene ordenado por visitas DESC, así
      // que lo que se corta es siempre lo menos relevante.
      prisma.$queryRaw<Array<{ etiqueta: string | null; tipo: string; visitas: bigint; unicos: bigint }>>`
        SELECT etiqueta, tipo::text AS tipo, COUNT(*) AS visitas, COUNT(DISTINCT "visitanteId") AS unicos
        FROM "Visita"
        WHERE "creadoEn" >= ${desde} AND "creadoEn" < ${hasta}
        GROUP BY 1, 2 ORDER BY visitas DESC LIMIT 50`,
    ]);
    return {
      total: Number(totales[0]?.visitas ?? 0),
      unicos: Number(totales[0]?.unicos ?? 0),
      porTipo,
      porEtiqueta,
    };
  },
};
