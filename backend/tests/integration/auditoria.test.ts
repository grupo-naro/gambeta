import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { hashPassword } from '../../src/utils/password.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(resetTables);

async function admin() {
  const u = await getPrisma().adminUser.create({ data: { email: 'a@a.com', nombre: 'Ana Admin', passwordHash: await hashPassword('x'), rol: 'ADMIN', esDefault: true } });
  return { u, tok: signAdminToken({ adminId: u.id, email: u.email, rol: 'ADMIN' }) };
}

describe('auditoría', () => {
  it('PATCH /config (cambia alias) crea un log con descripción que menciona alias y NO el valor', async () => {
    const { u, tok } = await admin();
    await getPrisma().configuracion.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} });
    const res = await supertest(app).patch('/config').set('authorization', `Bearer ${tok}`).send({ alias: 'mi.alias.secreto' });
    expect(res.status).toBe(200);
    const logs = await getPrisma().auditLog.findMany({ where: { entidad: 'Config' } });
    expect(logs.length).toBe(1);
    expect(logs[0].descripcion.toLowerCase()).toContain('alias');
    expect(logs[0].descripcion).not.toContain('mi.alias.secreto');
    expect(logs[0].adminId).toBe(u.id);
  });

  it('GET /auditoria: RECEPCIONISTA → 403; ADMIN → newest-first con usuario; filtra por entidad', async () => {
    const { u, tok } = await admin();
    await getPrisma().auditLog.create({ data: { adminId: u.id, accion: 'CREAR', entidad: 'Cancha', descripcion: 'Creó la cancha A' } });
    await getPrisma().auditLog.create({ data: { adminId: null, accion: 'LOGIN', entidad: 'Auth', descripcion: 'Inició sesión' } });

    const recep = signAdminToken({ adminId: 'z', email: 'r@r.com', rol: 'RECEPCIONISTA' });
    expect((await supertest(app).get('/auditoria').set('authorization', `Bearer ${recep}`)).status).toBe(403);

    const res = await supertest(app).get('/auditoria').set('authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].creadoEn >= res.body[1].creadoEn).toBe(true); // newest-first
    const cancha = res.body.find((l: any) => l.entidad === 'Cancha');
    expect(cancha.usuario).toBe('Ana Admin');
    const auth = res.body.find((l: any) => l.entidad === 'Auth');
    expect(auth.usuario).toBe('Sistema'); // adminId null

    const filt = await supertest(app).get('/auditoria?entidad=Cancha').set('authorization', `Bearer ${tok}`);
    expect(filt.body.every((l: any) => l.entidad === 'Cancha')).toBe(true);
  });
});
