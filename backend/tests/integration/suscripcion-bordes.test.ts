import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { suscripcionService } from '../../src/services/suscripcion.service.js';
import { aFechaUtc, hoyEnTz, sumarUnMes } from '../../src/services/suscripcion.vigencia.js';

let app: any;
let canchaId: string;
const TZ = 'America/Argentina/Buenos_Aires';

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
let adminId: string;
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C1', tipo: 'f5', precioHora: 12000, jugadores: 5 } })).id;
  await getPrisma().configuracion.create({ data: { id: 'default' } });
  // AdminUser real: reservaService.reprogramar/cancelar escriben un AuditLog con este id
  // (FK adminId -> AdminUser), igual que reprogramar.test.ts y reserva.cancelar.test.ts.
  adminId = (await getPrisma().adminUser.create({ data: { email: 'admin-bordes@test.local', nombre: 'Admin', passwordHash: 'x' } })).id;
});

async function socioVigenteHasta(vencimiento: string, whatsapp: string) {
  const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp } });
  const s = await getPrisma().suscripcion.create({
    data: { clienteId: c.id, inicio: aFechaUtc('2026-01-01'), vencimiento: aFechaUtc(vencimiento) },
  });
  return { cliente: c, suscripcion: s };
}

function enDias(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

async function reservar(whatsapp: string, fecha: string) {
  return supertest(app).post('/reservas').set('x-api-key', 'svc').send({
    canchaId, whatsapp, nombreCliente: 'Socio', esContacto: false, fecha, horaInicio: '18:00',
  });
}

describe('bordes de suscripcion', () => {
  it('socio cuya suscripcion vence HOY: el turno de mañana queda bonificado (vencimiento inclusive)', async () => {
    const hoy = hoyEnTz(TZ);
    await socioVigenteHasta(hoy, '5491178100001');
    const res = await reservar('5491178100001', enDias(1));
    expect(res.status).toBe(201);
    expect(res.body.suscripcionId).not.toBeNull();
    expect(Number(res.body.monto)).toBe(0);
  });

  it('turno para DESPUES del vencimiento queda bonificado igual (congelado al reservar)', async () => {
    const vence = enDias(2);
    await socioVigenteHasta(vence, '5491178100002');
    const res = await reservar('5491178100002', enDias(10)); // el turno cae después del vencimiento
    expect(res.status).toBe(201);
    // La vigencia se evalúa contra HOY, no contra la fecha del turno: el socio está vigente
    // al momento de reservar, así que el turno queda bonificado para siempre.
    expect(res.body.suscripcionId).not.toBeNull();
    expect(Number(res.body.monto)).toBe(0);
  });

  it('turno DENTRO del periodo queda bonificado', async () => {
    const vence = enDias(10);
    await socioVigenteHasta(vence, '5491178100003');
    const res = await reservar('5491178100003', enDias(3));
    expect(res.body.suscripcionId).not.toBeNull();
    expect(Number(res.body.monto)).toBe(0);
  });

  it('reprogramar un turno bonificado NO recalcula el monto', async () => {
    const vence = enDias(10);
    await socioVigenteHasta(vence, '5491178100004');
    const creada = await reservar('5491178100004', enDias(3));
    const { reservaService } = await import('../../src/services/reserva.service.js');
    await reservaService.reprogramar(creada.body.id, { adminId }, { fecha: enDias(4), horaInicio: '19:00' });
    const r = await getPrisma().reserva.findUnique({ where: { id: creada.body.id } });
    expect(Number(r!.monto)).toBe(0);
    expect(r!.suscripcionId).toBe(creada.body.suscripcionId);
  });

  it('cancelar un turno bonificado no deja cobros colgados', async () => {
    const vence = enDias(10);
    await socioVigenteHasta(vence, '5491178100005');
    const creada = await reservar('5491178100005', enDias(3));
    const { reservaService } = await import('../../src/services/reserva.service.js');
    await reservaService.cancelar(creada.body.id, { adminId });
    const r = await getPrisma().reserva.findUnique({ where: { id: creada.body.id } });
    expect(r!.estado).toBe('CANCELADA');
    expect(await getPrisma().cobro.count({ where: { reservaId: creada.body.id } })).toBe(0);
  });

  it('dar de alta una suscripcion nueva tras cancelar la anterior no choca por solapamiento', async () => {
    const hoy = hoyEnTz(TZ);
    const { cliente, suscripcion } = await socioVigenteHasta(sumarUnMes(hoy), '5491178100006');
    await suscripcionService.cancelar(suscripcion.id);
    const nueva = await suscripcionService.crear(
      { clienteId: cliente.id, inicio: hoy, vencimiento: sumarUnMes(hoy) },
      null,
    );
    expect(nueva.id).not.toBe(suscripcion.id);
  });

  it('el socio ocupa la cancha igual: un tercero no puede reservar el mismo slot', async () => {
    const vence = enDias(10);
    await socioVigenteHasta(vence, '5491178100007');
    const fecha = enDias(3);
    const primera = await reservar('5491178100007', fecha);
    expect(primera.status).toBe(201);
    const segunda = await reservar('5491178100008', fecha);
    expect(segunda.status).toBe(409);
  });
});
