import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);

beforeEach(async () => {
  await resetTables();
  // v1 entra dos veces por Instagram (dos sesiones), v2 una vez por Instagram y v3 por
  // WhatsApp. Total 4 visitas, 3 visitantes únicos.
  await getPrisma().visita.createMany({ data: [
    { etiqueta: 'ig-bio', tipo: 'REDES', sesionId: 'a', visitanteId: 'v1', creadoEn: new Date('2026-06-12T15:00:00.000Z') },
    { etiqueta: 'ig-bio', tipo: 'REDES', sesionId: 'b', visitanteId: 'v1', creadoEn: new Date('2026-06-12T18:00:00.000Z') },
    { etiqueta: 'ig-bio', tipo: 'REDES', sesionId: 'c', visitanteId: 'v2', creadoEn: new Date('2026-06-13T15:00:00.000Z') },
    { etiqueta: 'whatsapp', tipo: 'WHATSAPP', sesionId: 'd', visitanteId: 'v3', creadoEn: new Date('2026-06-13T16:00:00.000Z') },
  ]});
});

const qs = 'desde=2026-06-10&hasta=2026-06-15';

describe('GET /analytics/origenes', () => {
  it('cuenta visitas y visitantes únicos', async () => {
    const res = await supertest(app).get(`/analytics/origenes?${qs}`).set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.unicos).toBe(3);
  });

  it('agrupa por tipo', async () => {
    const res = await supertest(app).get(`/analytics/origenes?${qs}`).set('authorization', `Bearer ${token}`);
    const redes = res.body.porTipo.find((r: any) => r.tipo === 'REDES');
    expect(redes.visitas).toBe(3);
    expect(redes.unicos).toBe(2);
    const wsp = res.body.porTipo.find((r: any) => r.tipo === 'WHATSAPP');
    expect(wsp.visitas).toBe(1);
  });

  it('agrupa por etiqueta', async () => {
    const res = await supertest(app).get(`/analytics/origenes?${qs}`).set('authorization', `Bearer ${token}`);
    const ig = res.body.porEtiqueta.find((r: any) => r.etiqueta === 'ig-bio');
    expect(ig.visitas).toBe(3);
    expect(ig.tipo).toBe('REDES');
  });

  it('respeta el rango de fechas', async () => {
    const res = await supertest(app).get('/analytics/origenes?desde=2026-01-01&hasta=2026-01-31').set('authorization', `Bearer ${token}`);
    expect(res.body.total).toBe(0);
    expect(res.body.porTipo).toEqual([]);
  });

  it('es sólo para admin: la service key no alcanza', async () => {
    await supertest(app).get('/analytics/origenes').set('x-api-key', 'svc').expect(401);
  });
});
