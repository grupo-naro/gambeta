import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables } from '../helpers/db.js';

let app: any;
const ORIG = process.env.SERVICE_API_KEYS;
beforeAll(async () => {
  await setupTestDb();
  process.env.SERVICE_API_KEYS = 'rotada-nueva-123';
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(async () => { process.env.SERVICE_API_KEYS = ORIG; await teardownTestDb(); });
beforeEach(resetTables);

// GET /reservas/mias usa authAny y no requiere seed (cliente sin reservas → []).
const mias = (key: string) => supertest(app).get('/reservas/mias?whatsapp=5491100000000').set('x-api-key', key);

describe('rotación de service key (authAny)', () => {
  it('acepta la key primaria (svc, la de los tests)', async () => {
    const r = await mias('svc');
    expect(r.status).toBe(200);
  });
  it('acepta una key extra de SERVICE_API_KEYS', async () => {
    const r = await mias('rotada-nueva-123');
    expect(r.status).toBe(200);
  });
  it('rechaza una key inválida con 401', async () => {
    const r = await mias('no-soy-valida');
    expect(r.status).toBe(401);
  });
});
