import { prisma } from '../db/prisma.js';
import { getEnv } from '../config/env.js';

const ID = 'default';

export const configRepo = {
  getOrCreate() {
    const env = getEnv();
    // upsert: atómico, sin race en cold start (dos requests simultáneos no chocan en el PK).
    return prisma.configuracion.upsert({
      where: { id: ID },
      update: {},
      create: {
        id: ID,
        horaApertura: '16:00',
        horaCierre: '23:00',
        adminWhatsapp: '',
        senaModo: env.SENA_MODO === 'fijo' ? 'FIJO' : 'PORCENTAJE',
        senaPorcentaje: env.SENA_PORCENTAJE,
        senaMontoFijo: env.SENA_MONTO_FIJO,
        cbu: env.SENA_CBU,
        alias: env.SENA_ALIAS,
        titular: env.SENA_TITULAR,
      },
    });
  },
  async update(data: Record<string, unknown>) {
    await configRepo.getOrCreate();
    return prisma.configuracion.update({ where: { id: ID }, data });
  },
};
