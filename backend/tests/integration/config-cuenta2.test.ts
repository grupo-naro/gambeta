import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' }); });
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('config: cuenta de pago secundaria', () => {
  it('PATCH guarda alias2/cbu2/titular2 y GET los devuelve', async () => {
    const patch = await supertest(app).patch('/config').set('authorization', `Bearer ${token}`)
      .send({ alias2: 'complejo.alias2', cbu2: '0000003100010000000002', titular2: 'Otro Titular' });
    expect(patch.status).toBeLessThan(400);
    const get = await supertest(app).get('/config').set('authorization', `Bearer ${token}`);
    expect(get.body.alias2).toBe('complejo.alias2');
    expect(get.body.cbu2).toBe('0000003100010000000002');
    expect(get.body.titular2).toBe('Otro Titular');
  });
});
