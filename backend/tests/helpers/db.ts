import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/db/client.js';

let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] });
    prisma = new PrismaClient({ adapter });
  }
  return prisma;
}

// Compatibility shims for tests that call these in beforeAll/afterAll.
export async function setupTestDb(): Promise<PrismaClient> {
  return getPrisma();
}

export async function teardownTestDb(): Promise<void> {
  // Container lifecycle is handled by globalSetup — nothing to do here.
}

export async function resetTables(): Promise<void> {
  const p = getPrisma();
  await p.$transaction([
    p.ventaBuffet.deleteMany(),
    p.ticketBuffet.deleteMany(),
    p.cajaBuffet.deleteMany(),
    p.productoBuffet.deleteMany(),
    p.auditLog.deleteMany(),
    p.cobro.deleteMany(),
    p.pago.deleteMany(),
    p.reservaSector.deleteMany(),
    p.reserva.deleteMany(),
    p.suscripcion.deleteMany(),
    p.turnoFijoExcepcion.deleteMany(),
    p.turnoFijo.deleteMany(),
    p.bloqueo.deleteMany(),
    p.canchaSector.deleteMany(),
    p.horarioDisponible.deleteMany(),
    p.sector.deleteMany(),
    p.cancha.deleteMany(),
    p.canchaGrupo.deleteMany(),
    p.cliente.deleteMany(),
    p.adminUser.deleteMany(),
    p.configuracion.deleteMany(),
    p.mercadoPagoCuenta.deleteMany(),
  ]);
}
