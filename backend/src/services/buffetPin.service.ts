import { prisma } from '../db/prisma.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

const CONFIG_ID = 'default';

export const buffetPinService = {
  async setear(pin: string): Promise<void> {
    const buffetPinHash = await hashPassword(pin);
    await prisma.configuracion.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, buffetPinHash },
      update: { buffetPinHash },
    });
  },

  async verificar(pin: string): Promise<boolean> {
    const cfg = await prisma.configuracion.findUnique({ where: { id: CONFIG_ID } });
    // Sin PIN configurado no entra nadie: un hash vacío nunca matchea.
    if (!cfg?.buffetPinHash) return false;
    return verifyPassword(pin, cfg.buffetPinHash);
  },
};
