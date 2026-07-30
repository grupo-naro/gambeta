import { prisma } from './db/prisma.js';
import bcrypt from 'bcrypt';

// Seed de DEMO. Poblá una base de demo, no producción.
// Idempotente por ids `demo-*`. Correr con: npm run seed:demo
async function main() {
  // 1) Admin de demo
  const email = process.env.ADMIN_SEED_EMAIL ?? 'admin@gambeteando.com.ar';
  const password = process.env.ADMIN_SEED_PASSWORD ?? 'Gambeteando2026';
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.adminUser.upsert({
    where: { email },
    create: { email, nombre: 'Admin', passwordHash, rol: 'ADMIN', esDefault: true },
    // Reseedear reescribe la clave: si cambiás ADMIN_SEED_PASSWORD, se aplica.
    update: { passwordHash, rol: 'ADMIN', esDefault: true },
  });

  // 2) Canchas (con su sector 1:1 y horarios 16-23 los 7 días)
  const canchasDef = [
    { id: 'demo-f5-1', nombre: 'Cancha 1', tipo: 'futbol5', precioHora: 14000 },
    { id: 'demo-f5-2', nombre: 'Cancha 2', tipo: 'futbol5', precioHora: 14000 },
    { id: 'demo-f7-1', nombre: 'Cancha 3', tipo: 'futbol7', precioHora: 20000 },
    { id: 'demo-padel-1', nombre: 'Pádel 1', tipo: 'padel', precioHora: 9000 },
  ];
  const sectorPorCancha = new Map<string, string>();
  for (const c of canchasDef) {
    const cancha = await prisma.cancha.upsert({
      where: { id: c.id },
      create: { id: c.id, nombre: c.nombre, tipo: c.tipo, precioHora: c.precioHora },
      update: {},
    });
    for (let dia = 0; dia <= 6; dia++) {
      const exists = await prisma.horarioDisponible.findFirst({ where: { canchaId: cancha.id, diaSemana: dia } });
      if (!exists) {
        await prisma.horarioDisponible.create({
          data: { canchaId: cancha.id, diaSemana: dia, horaInicio: '16:00', horaFin: '23:00' },
        });
      }
    }
    const conSector = await prisma.cancha.findUnique({ where: { id: cancha.id }, include: { sectores: true } });
    let sectorId = conSector?.sectores[0]?.sectorId;
    if (!sectorId) {
      const s = await prisma.sector.create({ data: { nombre: cancha.nombre } });
      await prisma.canchaSector.create({ data: { canchaId: cancha.id, sectorId: s.id } });
      sectorId = s.id;
    }
    sectorPorCancha.set(cancha.id, sectorId);
  }

  // 3) Clientes ficticios. En el schema el teléfono es `whatsapp` (String @unique)
  //    y `nombre` es obligatorio. No existe campo `telefono`.
  const nombres = ['Juan Pérez', 'Sofía Gómez', 'Martín Díaz', 'Lucía Fernández', 'Diego Romero',
    'Valentina Ruiz', 'Nicolás Torres', 'Camila Sosa', 'Federico Luna', 'Agustina Ríos'];
  const clientes: { id: string; nombre: string; whatsapp: string }[] = [];
  for (let i = 0; i < nombres.length; i++) {
    const whatsapp = `549110000${String(1000 + i)}`;
    const cli = await prisma.cliente.upsert({
      where: { whatsapp },
      create: { whatsapp, nombre: nombres[i] },
      update: { nombre: nombres[i] },
    });
    clientes.push({ id: cli.id, nombre: cli.nombre, whatsapp });
  }
  const precioPorCancha = new Map(canchasDef.map((c) => [c.id, c.precioHora]));

  // 4) Reservas repartidas en la semana actual (lunes..domingo)
  const hoy = new Date();
  const lunes = new Date(hoy);
  const offsetALunes = (hoy.getDay() + 6) % 7; // 0=lunes
  lunes.setDate(hoy.getDate() - offsetALunes);
  lunes.setHours(0, 0, 0, 0);

  const canchaIds = canchasDef.map((c) => c.id);
  const horas = [18, 19, 20, 21, 22];
  let idx = 0;
  for (let dia = 0; dia < 7; dia++) {
    const reservasDelDia = 2 + (dia % 3); // 2..4 por día
    for (let k = 0; k < reservasDelDia; k++) {
      const canchaId = canchaIds[idx % canchaIds.length];
      const hora = horas[(idx + k) % horas.length];
      const inicio = new Date(lunes);
      inicio.setDate(lunes.getDate() + dia);
      inicio.setHours(hora, 0, 0, 0);
      const fin = new Date(inicio);
      fin.setHours(hora + 1, 0, 0, 0);
      const cliente = clientes[idx % clientes.length];
      // EstadoReserva válidos: CONFIRMADA | ESPERANDO_SENA | CANCELADA | COMPLETADA.
      // Alternamos confirmadas y en espera de seña para poblar los filtros del panel.
      const estado = idx % 3 === 0 ? 'ESPERANDO_SENA' : 'CONFIRMADA';
      const monto = precioPorCancha.get(canchaId)!;
      const montoSena = estado === 'ESPERANDO_SENA' ? Math.round(monto / 2) : null;
      const reservaId = `demo-res-${dia}-${k}`;

      const existe = await prisma.reserva.findUnique({ where: { id: reservaId } });
      if (!existe) {
        await prisma.reserva.create({
          data: {
            id: reservaId,
            canchaId,
            clienteId: cliente.id,
            fechaInicio: inicio,
            fechaFin: fin,
            estado,
            esContacto: false,
            monto,
            montoSena,
          },
        });
        await prisma.reservaSector.create({
          data: {
            reservaId,
            sectorId: sectorPorCancha.get(canchaId)!,
            estado,
            fechaInicio: inicio,
            fechaFin: fin,
          },
        });
      }
      idx++;
    }
  }

  // 5) Config básica
  const { configRepo } = await import('./repositories/config.repo.js');
  const cfg = await configRepo.getOrCreate();
  if (!cfg.adminWhatsapp) await configRepo.update({ adminWhatsapp: '5491100001111' });

  console.log(`Seed demo completo: ${canchasDef.length} canchas, ${clientes.length} clientes, ~${idx} reservas`);
}

main().finally(() => prisma.$disconnect());
