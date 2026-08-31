import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

// `tests/helpers/global-setup.ts` setea SERVICE_API_KEY='svc'; el resto de los tests de
// integración usan ese literal (ver `tests/integration/sena.test.ts`).
const clave = 'svc';

describe('POST /visitas', () => {
  it('registra la visita y le deriva el tipo a partir de la etiqueta', async () => {
    const res = await supertest(app).post('/visitas').set('x-api-key', clave)
      .send({ etiqueta: 'ig-bio', sesionId: 's1', visitanteId: 'v1', referer: 'https://instagram.com/' });
    expect(res.status).toBe(204);
    const v = await getPrisma().visita.findUnique({ where: { sesionId: 's1' } });
    expect(v?.tipo).toBe('REDES');
    expect(v?.etiqueta).toBe('ig-bio');
  });

  it('sin etiqueta la visita queda como DIRECTO', async () => {
    await supertest(app).post('/visitas').set('x-api-key', clave)
      .send({ sesionId: 's2', visitanteId: 'v2' }).expect(204);
    const v = await getPrisma().visita.findUnique({ where: { sesionId: 's2' } });
    expect(v?.tipo).toBe('DIRECTO');
    expect(v?.etiqueta).toBeNull();
  });

  it('es idempotente por sesionId: el beacon puede dispararse dos veces', async () => {
    const body = { etiqueta: 'whatsapp', sesionId: 'dup', visitanteId: 'v3' };
    await supertest(app).post('/visitas').set('x-api-key', clave).send(body).expect(204);
    await supertest(app).post('/visitas').set('x-api-key', clave).send(body).expect(204);
    expect(await getPrisma().visita.count()).toBe(1);
  });

  it('rechaza etiquetas que no matchean el formato de los links', async () => {
    await supertest(app).post('/visitas').set('x-api-key', clave)
      .send({ etiqueta: 'IG Bio!', sesionId: 's4', visitanteId: 'v4' }).expect(400);
    expect(await getPrisma().visita.count()).toBe(0);
  });

  it('exige autenticación', async () => {
    await supertest(app).post('/visitas')
      .send({ sesionId: 's5', visitanteId: 'v5' }).expect(401);
  });
});
