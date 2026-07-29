import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => { await resetTables(); const a = await getPrisma().adminUser.create({ data: { email: 'a@b.com', nombre: 'A', passwordHash: 'x' } }); token = signAdminToken({ adminId: a.id, email: a.email, rol: 'ADMIN' }); });

const fecha = () => new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
async function crearDivisible() {
  const r = await supertest(app).post('/canchas/divisible').set('authorization', `Bearer ${token}`).send({ nombre: 'Cancha 4', partes: 3, precioEntera: 30000, precioParte: 12000, jugadoresEntera: 5, jugadoresParte: 5 });
  return r;
}
const reservar = (canchaId: string, wa: string) =>
  supertest(app).post('/reservas').set('x-api-key', 'svc').send({ canchaId, whatsapp: wa, nombreCliente: 'X', esContacto: true, fecha: fecha(), horaInicio: '20:00' });

describe('canchas divisibles', () => {
  it('crea grupo + 3 sectores + 4 unidades con precios', async () => {
    const r = await crearDivisible();
    expect(r.status).toBe(201);
    expect(r.body).toHaveLength(4);
    const entera = r.body.find((c: any) => c.esEntera);
    expect(Number(entera.precioHora)).toBe(30000);
    expect(await getPrisma().sector.count()).toBe(3);
  });
  it('reservar la entera bloquea las partes', async () => {
    const cs = (await crearDivisible()).body;
    const entera = cs.find((c: any) => c.esEntera); const parte = cs.find((c: any) => !c.esEntera);
    expect((await reservar(entera.id, '+5491150000000')).status).toBe(201);
    expect((await reservar(parte.id, '+5491150000001')).status).toBe(409);
  });
  it('reservar una parte bloquea la entera', async () => {
    const cs = (await crearDivisible()).body;
    const entera = cs.find((c: any) => c.esEntera); const parte = cs.find((c: any) => !c.esEntera);
    expect((await reservar(parte.id, '+5491150000000')).status).toBe(201);
    expect((await reservar(entera.id, '+5491150000001')).status).toBe(409);
  });
  it('dos partes distintas conviven', async () => {
    const cs = (await crearDivisible()).body;
    const partes = cs.filter((c: any) => !c.esEntera);
    expect((await reservar(partes[0].id, '+5491150000000')).status).toBe(201);
    expect((await reservar(partes[1].id, '+5491150000001')).status).toBe(201);
  });
});

describe('disponibilidad por sectores', () => {
  it('la parte no muestra el slot ocupado por la entera', async () => {
    const cs = (await crearDivisible()).body;
    const entera = cs.find((c: any) => c.esEntera); const parte = cs.find((c: any) => !c.esEntera);
    await reservar(entera.id, '+5491150000000'); // ocupa 20:00 en los 3 sectores
    const disp = await supertest(app).get('/disponibilidad').query({ canchaId: parte.id, fecha: fecha() }).set('x-api-key', 'svc');
    expect(disp.status).toBe(200);
    expect(disp.body.slots.map((s: any) => s.horaInicio)).not.toContain('20:00');
  });
});

describe('eliminar divisible', () => {
  it('borra todo el grupo cuando no hay reservas', async () => {
    const cs = (await crearDivisible()).body;
    const entera = cs.find((c: any) => c.esEntera);
    const res = await supertest(app).delete(`/canchas/${entera.id}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(await getPrisma().cancha.count()).toBe(0);
    expect(await getPrisma().sector.count()).toBe(0);
  });
  it('409 si una unidad del grupo tiene reservas', async () => {
    const cs = (await crearDivisible()).body;
    const parte = cs.find((c: any) => !c.esEntera); const entera = cs.find((c: any) => c.esEntera);
    await reservar(parte.id, '+5491150000000');
    const res = await supertest(app).delete(`/canchas/${entera.id}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
  });
});
