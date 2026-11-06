import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  token = signAdminToken({ adminId: 'admin-1', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);
beforeEach(async () => { await resetTables(); });

const auth = (r: supertest.Test, t = token) => r.set('authorization', `Bearer ${t}`);
const poner = (pin: string, pinActual?: string) => auth(supertest(app).put('/config/dashboard-pin')).send({ pin, pinActual });
const verificar = (pin: string, t = token) => auth(supertest(app).post('/config/dashboard-pin/verificar'), t).send({ pin });
const ingresos = (unlock?: string) => {
  const r = auth(supertest(app).get('/analytics/ingresos'));
  return unlock ? r.set('x-dashboard-unlock', unlock) : r;
};
const estado = (unlock?: string) => {
  const r = auth(supertest(app).get('/config/dashboard-pin/estado'));
  return unlock ? r.set('x-dashboard-unlock', unlock) : r;
};

describe('PIN del dashboard', () => {
  it('sin PIN configurado el dashboard está abierto, como siempre', async () => {
    expect((await ingresos()).status).toBe(200);
    expect((await estado()).body).toEqual({ configurado: false, desbloqueado: true });
  });

  it('con PIN configurado, los datos de analytics quedan bloqueados (403) sin el desbloqueo', async () => {
    expect((await poner('1234')).status).toBe(200);
    const r = await ingresos();
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('DASHBOARD_BLOQUEADO');
    expect((await estado()).body).toEqual({ configurado: true, desbloqueado: false });
  });

  it('el PIN correcto da un token que desbloquea', async () => {
    await poner('1234');
    const v = await verificar('1234');
    expect(v.status).toBe(200);
    expect(typeof v.body.token).toBe('string');
    expect((await ingresos(v.body.token)).status).toBe(200);
    expect((await estado(v.body.token)).body).toEqual({ configurado: true, desbloqueado: true });
  });

  it('un PIN incorrecto es 401 y no da token', async () => {
    await poner('1234');
    const v = await verificar('9999');
    expect(v.status).toBe(401);
    expect(v.body.token).toBeUndefined();
  });

  it('un token inventado no desbloquea', async () => {
    await poner('1234');
    expect((await ingresos('basura')).status).toBe(403);
  });

  it('el token de un admin no sirve para otro', async () => {
    await poner('1234');
    const v = await verificar('1234');
    const otro = signAdminToken({ adminId: 'admin-2', email: 'o@b.com', rol: 'ADMIN' });
    const r = await auth(supertest(app).get('/analytics/ingresos'), otro).set('x-dashboard-unlock', v.body.token);
    expect(r.status).toBe(403);
  });

  it('el PIN no se guarda en claro ni se devuelve en la configuración', async () => {
    await poner('1234');
    const cfg = await auth(supertest(app).get('/config'));
    expect(JSON.stringify(cfg.body)).not.toMatch(/1234|dashboardPinHash/);
  });

  it('cambiar el PIN exige el PIN actual', async () => {
    await poner('1234');
    expect((await poner('5678')).status).toBe(401);
    expect((await poner('5678', '0000')).status).toBe(401);
    expect((await poner('5678', '1234')).status).toBe(200);
    expect((await verificar('5678')).status).toBe(200);
    expect((await verificar('1234')).status).toBe(401);
  });

  it('cambiar el PIN invalida los desbloqueos que ya estaban abiertos', async () => {
    await poner('1234');
    const v = await verificar('1234');
    expect((await ingresos(v.body.token)).status).toBe(200);
    await poner('5678', '1234');
    expect((await ingresos(v.body.token)).status).toBe(403);
  });

  it('quitar el PIN exige el PIN actual y deja el dashboard abierto', async () => {
    await poner('1234');
    const mal = await auth(supertest(app).post('/config/dashboard-pin/quitar')).send({ pinActual: '0000' });
    expect(mal.status).toBe(401);
    const bien = await auth(supertest(app).post('/config/dashboard-pin/quitar')).send({ pinActual: '1234' });
    expect(bien.status).toBe(200);
    expect((await ingresos()).status).toBe(200);
  });

  it('el PIN tiene entre 4 y 8 dígitos', async () => {
    expect((await poner('123')).status).toBe(400);
    expect((await poner('123456789')).status).toBe(400);
    expect((await poner('12ab')).status).toBe(400);
    expect((await poner('12345678')).status).toBe(200);
  });

  it('un recepcionista no puede ver ni tocar nada de esto (403)', async () => {
    const recep = signAdminToken({ adminId: 'r-1', email: 'r@b.com', rol: 'RECEPCIONISTA' });
    expect((await auth(supertest(app).put('/config/dashboard-pin'), recep).send({ pin: '1234' })).status).toBe(403);
    expect((await auth(supertest(app).get('/config/dashboard-pin/estado'), recep)).status).toBe(403);
    expect((await verificar('1234', recep)).status).toBe(403);
  });
});
