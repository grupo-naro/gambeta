import { prisma } from '../db/prisma.js';

const ACTIVE = ['CONFIRMADA', 'COMPLETADA'] as const;

export const analyticsService = {
  async ingresos(desde: Date, hasta: Date) {
    const agg = await prisma.reserva.aggregate({
      _sum: { monto: true },
      where: { estado: { in: [...ACTIVE] }, fechaInicio: { gte: desde, lt: hasta } },
    });
    return { total: agg._sum.monto ?? 0 };
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
      prisma.$queryRaw<Array<{ etiqueta: string | null; tipo: string; visitas: bigint; unicos: bigint }>>`
        SELECT etiqueta, tipo::text AS tipo, COUNT(*) AS visitas, COUNT(DISTINCT "visitanteId") AS unicos
        FROM "Visita"
        WHERE "creadoEn" >= ${desde} AND "creadoEn" < ${hasta}
        GROUP BY 1, 2 ORDER BY visitas DESC`,
    ]);
    return {
      total: Number(totales[0]?.visitas ?? 0),
      unicos: Number(totales[0]?.unicos ?? 0),
      porTipo,
      porEtiqueta,
    };
  },
};
