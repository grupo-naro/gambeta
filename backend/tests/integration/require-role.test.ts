import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(resetTables);

const adminTok = () => signAdminToken({ adminId: 'x', email: 'a@a.com', rol: 'ADMIN' });
const recepTok = () => signAdminToken({ adminId: 'y', email: 'r@r.com', rol: 'RECEPCIONISTA' });

describe('requireRole(ADMIN) en PATCH /config', () => {
  it('RECEPCIONISTA → 403', async () => {
    const res = await supertest(app).patch('/config').set('authorization', `Bearer ${recepTok()}`).send({ horaApertura: '16:00' });
    expect(res.status).toBe(403);
  });
  it('ADMIN → no 403', async () => {
    const res = await supertest(app).patch('/config').set('authorization', `Bearer ${adminTok()}`).send({ horaApertura: '16:00' });
    expect(res.status).not.toBe(403);
  });
});

describe('GET turnos-fijos accesible a RECEPCIONISTA', () => {
  it('RECEPCIONISTA → 200', async () => {
    const res = await supertest(app).get('/turnos-fijos').set('authorization', `Bearer ${recepTok()}`);
    expect(res.status).toBe(200);
  });
});

describe('POST turnos-fijos accesible a RECEPCIONISTA', () => {
  it('RECEPCIONISTA puede crear un turno fijo (no 403)', async () => {
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } });
    const res = await supertest(app)
      .post('/turnos-fijos')
      .set('authorization', `Bearer ${recepTok()}`)
      .send({ canchaId: cancha.id, clienteNombre: 'Cliente Test', whatsapp: '5491150000000', diaSemana: 2, horaInicio: '10:00', horaFin: '11:00' });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(201);
  });
});
