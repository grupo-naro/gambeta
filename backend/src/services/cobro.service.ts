import { cobroRepo } from '../repositories/cobro.repo.js';
import { reservaRepo } from '../repositories/reserva.repo.js';
import { adminUserRepo } from '../repositories/adminUser.repo.js';
import { NotFound } from '../utils/errors.js';
import { sheetsSync } from './sheets/sheetsSync.service.js';
import { ymdEnTz } from './sheets/sheetsData.js';

async function saldoDe(reservaId: string, monto: number) {
  const pagado = await cobroRepo.sumByReserva(reservaId);
  return { pagado, saldo: Math.max(0, monto - pagado) };
}

export const cobroService = {
  async listByReserva(reservaId: string) {
    const r = await reservaRepo.findById(reservaId);
    if (!r) throw NotFound('Reserva', reservaId);
    const cobros = await cobroRepo.listByReserva(reservaId);
    const monto = Number(r.monto);
    const pagado = cobros.reduce((s, c) => s + Number(c.monto), 0);
    return {
      monto,
      pagado,
      saldo: Math.max(0, monto - pagado),
      cobros: cobros.map((c) => ({
        id: c.id,
        monto: Number(c.monto),
        medio: c.medio,
        origen: c.origen,
        registradoPor: c.registradoPor?.nombre ?? 'Sistema',
        creadoEn: c.creadoEn,
      })),
    };
  },

  async crear(
    reservaId: string,
    input: { monto: number; medio: 'EFECTIVO' | 'TRANSFERENCIA' },
    registradoPorId: string | null,
  ) {
    const r = await reservaRepo.findById(reservaId);
    if (!r) throw NotFound('Reserva', reservaId);
    // Verify admin exists to avoid FK violation; fall back to null (Sistema)
    const adminExists = registradoPorId ? !!(await adminUserRepo.findById(registradoPorId)) : false;
    const cobro = await cobroRepo.create({
      reservaId,
      monto: input.monto,
      medio: input.medio,
      origen: 'MANUAL',
      registradoPorId: adminExists ? registradoPorId : null,
    });
    const { pagado, saldo } = await saldoDe(reservaId, Number(r.monto));
    sheetsSync.marcarSucio(ymdEnTz(r.fechaInicio));
    return { cobro: { id: cobro.id, monto: Number(cobro.monto), medio: cobro.medio }, pagado, saldo };
  },

  async eliminar(id: string) {
    const c = await cobroRepo.findById(id);
    if (!c) throw NotFound('Cobro', id);
    const reserva = await reservaRepo.findById(c.reservaId);
    await cobroRepo.remove(id);
    if (reserva) sheetsSync.marcarSucio(ymdEnTz(reserva.fechaInicio));
    return { ok: true, monto: Number(c.monto) };
  },
};
