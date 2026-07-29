import { prisma } from './db/prisma.js';
import bcrypt from 'bcrypt';

// Seed idempotente: admin + 2 canchas + horarios. Reusa el singleton (adapter pg + DATABASE_URL).
// Dev: `npm run seed` (tsx). Prod/VM: `node dist/seed.js` (sin tsx, ya compilado).
async function main() {
  const email = process.env.ADMIN_SEED_EMAIL ?? 'admin@canchitas.com';
  const password = process.env.ADMIN_SEED_PASSWORD ?? 'change-me-admin';
  await prisma.adminUser.upsert({
    where: { email },
    create: { email, nombre: 'Admin', passwordHash: await bcrypt.hash(password, 10), rol: 'ADMIN', esDefault: true },
    update: { rol: 'ADMIN', esDefault: true },
  });

  for (const n of ['Cancha 1', 'Cancha 2']) {
    const cancha = await prisma.cancha.upsert({
      where: { id: `seed-${n}` },
      create: { id: `seed-${n}`, nombre: n, tipo: 'futbol5', precioHora: 12000 },
      update: {},
    });
    for (let dia = 0; dia <= 6; dia++) {
      const exists = await prisma.horarioDisponible.findFirst({
        where: { canchaId: cancha.id, diaSemana: dia },
      });
      if (!exists) {
        await prisma.horarioDisponible.create({
          data: { canchaId: cancha.id, diaSemana: dia, horaInicio: '16:00', horaFin: '23:00' },
        });
      }
    }
  }
  const { configRepo } = await import('./repositories/config.repo.js');
  const cfg = await configRepo.getOrCreate();
  if (!cfg.adminWhatsapp) await configRepo.update({ adminWhatsapp: '5491159582039' });

  // Backfill sectores: cada cancha sin sector → 1 sector propio; cada reserva sin ReservaSector → sus filas.
  const canchasAll = await prisma.cancha.findMany({ include: { sectores: true } });
  for (const c of canchasAll) {
    if (c.sectores.length === 0) {
      const s = await prisma.sector.create({ data: { nombre: c.nombre } });
      await prisma.canchaSector.create({ data: { canchaId: c.id, sectorId: s.id } });
    }
  }
  const reservasAll = await prisma.reserva.findMany({ include: { sectores: true, cancha: { include: { sectores: true } } } });
  for (const r of reservasAll) {
    if (r.sectores.length === 0) {
      await prisma.reservaSector.createMany({
        data: r.cancha.sectores.map((cs) => ({ reservaId: r.id, sectorId: cs.sectorId, estado: r.estado, fechaInicio: r.fechaInicio, fechaFin: r.fechaFin })),
      });
    }
  }

  console.log('Seed completo');
}

main().finally(() => prisma.$disconnect());
