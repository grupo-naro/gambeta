import { prisma } from '../db/prisma.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

export interface MostradorIdentificado { mostradorId: string; tipo: 'PRINCIPAL' | 'SECUNDARIO'; nombre: string }

export const buffetPinService = {
  async setear(mostradorId: string, pin: string): Promise<void> {
    await prisma.mostrador.update({ where: { id: mostradorId }, data: { pinHash: await hashPassword(pin) } });
  },

  /**
   * Devuelve QUÉ mostrador es, no solo si el PIN sirve. Recorre los mostradores activos y
   * compara contra cada hash: son dos, así que el costo es irrelevante.
   */
  async verificar(pin: string): Promise<MostradorIdentificado | null> {
    const mostradores = await prisma.mostrador.findMany({ where: { activo: true } });
    for (const m of mostradores) {
      // Un hash vacío nunca matchea: un mostrador sin PIN configurado no deja entrar a nadie.
      if (!m.pinHash) continue;
      if (await verifyPassword(pin, m.pinHash)) {
        return { mostradorId: m.id, tipo: m.tipo as 'PRINCIPAL' | 'SECUNDARIO', nombre: m.nombre };
      }
    }
    return null;
  },
};
