import { canchaRepo } from '../repositories/cancha.repo.js';
import { reservaRepo } from '../repositories/reserva.repo.js';
import { NotFound, Conflict, BusinessRule } from '../utils/errors.js';
import { prisma } from '../db/prisma.js';

export const canchaService = {
  list: (onlyActive?: boolean) => canchaRepo.list(onlyActive),
  get: async (id: string) => {
    const c = await canchaRepo.findById(id);
    if (!c) throw NotFound('Cancha', id);
    return c;
  },
  create: async (input: { nombre: string; tipo: string; precioHora: number; jugadores: number; destacada?: boolean; precioHoraPico?: number; senaMonto?: number | null }) => {
    if (input.senaMonto != null && Number(input.senaMonto) > Number(input.precioHora)) throw BusinessRule('La seña no puede superar el precio de la cancha');
    return prisma.$transaction(async (tx) => {
      const cancha = await tx.cancha.create({ data: input });
      const sector = await tx.sector.create({ data: { nombre: cancha.nombre } });
      await tx.canchaSector.create({ data: { canchaId: cancha.id, sectorId: sector.id } });
      return cancha;
    });
  },
  update: async (id: string, input: Partial<{ nombre: string; tipo: string; precioHora: number; jugadores: number; destacada: boolean; precioHoraPico: number; senaMonto: number | null }>) => {
    const actual = await canchaService.get(id);
    const precio = input.precioHora ?? Number(actual.precioHora);
    const sena = input.senaMonto !== undefined ? input.senaMonto : (actual.senaMonto != null ? Number(actual.senaMonto) : null);
    if (sena != null && Number(sena) > precio) throw BusinessRule('La seña no puede superar el precio de la cancha');
    return canchaRepo.update(id, input);
  },
  /**
   * Escalona las canchas de pádel activas: los turnos de todas arrancan cada `bloqueMin` y cada una empieza
   * `pasoMin` más tarde que la anterior (por orden de nombre: 1, 2, 3…). Con `bloqueMin: null`
   * vuelve todo a la agenda libre. Devuelve el desfase asignado a cada cancha.
   */
  escalonarPadel: async (bloqueMin: number | null, pasoMin: number, quitar = false) => {
    const canchas = (await canchaRepo.list(true))
      .filter((c) => c.tipo.toLowerCase() === 'padel')
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
    if (canchas.length === 0) throw BusinessRule('No hay canchas de pádel activas');
    // Cada cancha corre su primer turno `pasoMin` más que la anterior (07:00, 07:30, 08:00, 08:30…).
    const plan = canchas.map((c, i) => ({ c, desfase: quitar ? 0 : i * pasoMin }));
    if (quitar) bloqueMin = null;
    if (plan.some((p) => p.desfase > 120)) throw BusinessRule('Hay demasiadas canchas para escalonarlas con ese paso');
    await prisma.$transaction(plan.map(({ c, desfase }) =>
      prisma.cancha.update({ where: { id: c.id }, data: { turnoBloqueMin: bloqueMin, turnoDesfaseMin: desfase } })));
    return plan.map(({ c, desfase }) => ({ id: c.id, nombre: c.nombre, desfaseMin: desfase }));
  },
  setActiva: async (id: string, activa: boolean) => {
    await canchaService.get(id);
    return canchaRepo.update(id, { activa });
  },
  crearDivisible: ({ nombre, partes, precioEntera, precioParte, jugadoresEntera, jugadoresParte }: { nombre: string; partes: number; precioEntera: number; precioParte: number; jugadoresEntera: number; jugadoresParte: number }) =>
    prisma.$transaction(async (tx) => {
      const grupo = await tx.canchaGrupo.create({ data: { nombre } });
      const sectores = [];
      for (let i = 1; i <= partes; i++) sectores.push(await tx.sector.create({ data: { nombre: `${nombre} - ${i}` } }));
      const entera = await tx.cancha.create({ data: { nombre, tipo: 'futbol', precioHora: precioEntera, jugadores: jugadoresEntera, grupoId: grupo.id, esEntera: true } });
      await tx.canchaSector.createMany({ data: sectores.map((s) => ({ canchaId: entera.id, sectorId: s.id })) });
      for (let i = 0; i < partes; i++) {
        const parte = await tx.cancha.create({ data: { nombre: `${nombre} - ${i + 1}`, tipo: 'futbol', precioHora: precioParte, jugadores: jugadoresParte, grupoId: grupo.id, esEntera: false } });
        await tx.canchaSector.create({ data: { canchaId: parte.id, sectorId: sectores[i].id } });
      }
      return tx.cancha.findMany({ where: { grupoId: grupo.id }, orderBy: { esEntera: 'desc' } });
    }),
  eliminar: async (id: string) => {
    const c = await canchaService.get(id);
    if (c.grupoId) {
      const unidades = await prisma.cancha.findMany({ where: { grupoId: c.grupoId }, select: { id: true } });
      for (const u of unidades) {
        if ((await reservaRepo.countByCancha(u.id)) > 0) throw Conflict('Una cancha del grupo tiene reservas; desactivala en vez de eliminarla');
      }
      const sectorIds = (await prisma.canchaSector.findMany({ where: { canchaId: { in: unidades.map((u) => u.id) } }, select: { sectorId: true } })).map((s) => s.sectorId);
      await prisma.$transaction(async (tx) => {
        await tx.cancha.deleteMany({ where: { grupoId: c.grupoId! } }); // cascade borra CanchaSector
        await tx.sector.deleteMany({ where: { id: { in: Array.from(new Set(sectorIds)) } } });
        await tx.canchaGrupo.delete({ where: { id: c.grupoId! } });
      });
      return { ok: true };
    }
    if ((await reservaRepo.countByCancha(id)) > 0) throw Conflict('La cancha tiene reservas; desactivala en vez de eliminarla');
    const sectorIds = (await prisma.canchaSector.findMany({ where: { canchaId: id }, select: { sectorId: true } })).map((s) => s.sectorId);
    await prisma.$transaction(async (tx) => {
      await tx.cancha.delete({ where: { id } });
      await tx.sector.deleteMany({ where: { id: { in: sectorIds } } });
    });
    return { ok: true };
  },
};
