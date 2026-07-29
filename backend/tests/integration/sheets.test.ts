import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
const admin = () => signAdminToken({ adminId: 'a', email: 'a@a.com', rol: 'ADMIN' });
const recep = () => signAdminToken({ adminId: 'r', email: 'r@r.com', rol: 'RECEPCIONISTA' });

describe('sheets', () => {
  it('GET /sheets/info → configurado false en test (sin envs)', async () => {
    const res = await supertest(app).get('/sheets/info').set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(200);
    expect(res.body.configurado).toBe(false);
    expect(res.body.url).toBeNull();
  });
  it('POST /sheets/sync sin config → 503', async () => {
    const res = await supertest(app).post('/sheets/sync').set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(503);
  });
  it('RECEPCIONISTA no puede sincronizar → 403', async () => {
    const res = await supertest(app).post('/sheets/sync').set('authorization', `Bearer ${recep()}`);
    expect(res.status).toBe(403);
  });
});
