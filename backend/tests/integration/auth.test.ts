import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { hashPassword } from '../../src/utils/password.js';

let app: any;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('login con rol', () => {
  it('el token y la respuesta incluyen el rol', async () => {
    await getPrisma().adminUser.create({ data: { email: 'a@a.com', nombre: 'A', passwordHash: await hashPassword('secreto'), rol: 'ADMIN', esDefault: true } });
    const res = await supertest(app).post('/auth/login').send({ email: 'a@a.com', password: 'secreto' });
    expect(res.status).toBe(200);
    expect(res.body.admin.rol).toBe('ADMIN');
    const payload = jwt.decode(res.body.token) as any;
    expect(payload.rol).toBe('ADMIN');
  });
});
