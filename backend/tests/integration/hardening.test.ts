import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb } from '../helpers/db.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);

describe('helmet', () => {
  it('setea headers de seguridad', async () => {
    const r = await supertest(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('rate limit de login', () => {
  it('devuelve 429 tras superar el límite de intentos', async () => {
    const intento = () => supertest(app).post('/auth/login').send({ email: 'nadie@x.com', password: 'malisima' });
    let last = 0;
    for (let i = 0; i < 11; i++) { last = (await intento()).status; }
    expect(last).toBe(429);
  });
});
