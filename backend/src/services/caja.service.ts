import { getEnv } from '../config/env.js';
import { dayWindowUtc } from '../utils/tz.js';
import { cobroRepo } from '../repositories/cobro.repo.js';

export const cajaService = {
  async reporte(desde: string, hasta: string) {
    const tz = getEnv().TZ_NEGOCIO;
    const start = dayWindowUtc(desde, tz).start;
    const end = dayWindowUtc(hasta, tz).end;
    const rows = await cobroRepo.listRange(start, end);
    const porMedio = { EFECTIVO: 0, TRANSFERENCIA: 0 };
    const porConcepto = { turnos: 0, cuotas: 0, abonos: 0 };
    const porCanchaMap = new Map<string, { canchaId: string; nombre: string; total: number }>();
    let total = 0;
    for (const c of rows) {
      const m = Number(c.monto);
      total += m;
      porMedio[c.medio] += m;
      // Un cobro pertenece a una reserva, a una suscripción o a un turno fijo (abono) —
      // constraint cobro_destino_unico, "exactamente uno de los tres".
      if (c.suscripcionId) porConcepto.cuotas += m;
      else if (c.turnoFijoId) porConcepto.abonos += m;
      else porConcepto.turnos += m;
      const ca = c.reserva?.cancha;
      if (ca) {
        const e = porCanchaMap.get(ca.id) ?? { canchaId: ca.id, nombre: ca.nombre, total: 0 };
        e.total += m;
        porCanchaMap.set(ca.id, e);
      }
    }
    return {
      desde,
      hasta,
      total,
      porMedio,
      porConcepto,
      porCancha: [...porCanchaMap.values()].sort((a, b) => b.total - a.total),
      cobros: rows.map((c) => ({
        id: c.id,
        creadoEn: c.creadoEn,
        monto: Number(c.monto),
        medio: c.medio,
        concepto: c.suscripcionId ? ('CUOTA' as const) : c.turnoFijoId ? ('ABONO' as const) : ('TURNO' as const),
        cancha: c.reserva?.cancha?.nombre ?? '-',
        cliente: c.reserva?.cliente?.nombre ?? c.suscripcion?.cliente?.nombre ?? c.turnoFijo?.clienteNombre ?? '-',
        registradoPor: c.registradoPor?.nombre ?? 'Sistema',
      })),
    };
  },
};
