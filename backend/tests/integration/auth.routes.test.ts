import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
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

describe('POST /auth/login', () => {
  it('returns a token for valid credentials', async () => {
    await getPrisma().adminUser.create({
      data: { email: 'a@b.com', nombre: 'Admin', passwordHash: await hashPassword('pw') },
    });
    const res = await supertest(app).post('/auth/login').send({ email: 'a@b.com', password: 'pw' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('401 for wrong password', async () => {
    await getPrisma().adminUser.create({
      data: { email: 'a@b.com', nombre: 'Admin', passwordHash: await hashPassword('pw') },
    });
    const res = await supertest(app).post('/auth/login').send({ email: 'a@b.com', password: 'no' });
    expect(res.status).toBe(401);
  });

  it('400 for malformed body', async () => {
    const res = await supertest(app).post('/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});
