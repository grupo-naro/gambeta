import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(resetTables);

async function seedDefaultAdmin() {
  const { hashPassword } = await import('../../src/utils/password.js');
  return getPrisma().adminUser.create({ data: { email: 'admin@gambeteando.com', nombre: 'Admin', passwordHash: await hashPassword('x'), rol: 'ADMIN', esDefault: true } });
}
const tok = (id: string) => signAdminToken({ adminId: id, email: 'admin@gambeteando.com', rol: 'ADMIN' });

describe('/usuarios (ADMIN)', () => {
  it('crea, lista (sin hash) y respeta email único', async () => {
    const admin = await seedDefaultAdmin();
    const c = await supertest(app).post('/usuarios').set('authorization', `Bearer ${tok(admin.id)}`)
      .send({ email: 'recep@x.com', nombre: 'Recep', password: 'secreto', rol: 'RECEPCIONISTA' });
    expect(c.status).toBe(201);
    expect(c.body.rol).toBe('RECEPCIONISTA');
    expect(c.body.passwordHash).toBeUndefined();
    const dup = await supertest(app).post('/usuarios').set('authorization', `Bearer ${tok(admin.id)}`)
      .send({ email: 'recep@x.com', nombre: 'Otro', password: 'secreto', rol: 'RECEPCIONISTA' });
    expect(dup.status).toBe(409);
    const list = await supertest(app).get('/usuarios').set('authorization', `Bearer ${tok(admin.id)}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(2);
    expect(list.body[0].passwordHash).toBeUndefined();
  });

  it('cambia rol pero NO el del default', async () => {
    const admin = await seedDefaultAdmin();
    const r = await getPrisma().adminUser.create({ data: { email: 'r@x.com', nombre: 'R', passwordHash: 'h', rol: 'RECEPCIONISTA' } });
    const ok = await supertest(app).patch(`/usuarios/${r.id}/rol`).set('authorization', `Bearer ${tok(admin.id)}`).send({ rol: 'ADMIN' });
    expect(ok.status).toBe(200);
    expect(ok.body.rol).toBe('ADMIN');
    const no = await supertest(app).patch(`/usuarios/${admin.id}/rol`).set('authorization', `Bearer ${tok(admin.id)}`).send({ rol: 'RECEPCIONISTA' });
    expect(no.status).toBe(403);
  });

  it('un admin no puede cambiar su propio rol (self-demotion)', async () => {
    const admin = await seedDefaultAdmin();
    const otro = await getPrisma().adminUser.create({ data: { email: 'otro@x.com', nombre: 'Otro', passwordHash: 'h', rol: 'ADMIN' } });
    const res = await supertest(app).patch(`/usuarios/${otro.id}/rol`).set('authorization', `Bearer ${signAdminToken({ adminId: otro.id, email: 'otro@x.com', rol: 'ADMIN' })}`).send({ rol: 'RECEPCIONISTA' });
    expect(res.status).toBe(403);
  });

  it('elimina otros, pero NO el default ni a sí mismo', async () => {
    const admin = await seedDefaultAdmin();
    const r = await getPrisma().adminUser.create({ data: { email: 'r2@x.com', nombre: 'R2', passwordHash: 'h', rol: 'RECEPCIONISTA' } });
    expect((await supertest(app).delete(`/usuarios/${admin.id}`).set('authorization', `Bearer ${tok(admin.id)}`)).status).toBe(403); // default + self
    expect((await supertest(app).delete(`/usuarios/${r.id}`).set('authorization', `Bearer ${tok(admin.id)}`)).status).toBe(200);
  });

  it('RECEPCIONISTA no puede usar /usuarios', async () => {
    const res = await supertest(app).get('/usuarios').set('authorization', `Bearer ${signAdminToken({ adminId: 'z', email: 'r@r.com', rol: 'RECEPCIONISTA' })}`);
    expect(res.status).toBe(403);
  });

  it('crea con duracionDias y expone expiraEn en create y list', async () => {
    const admin = await seedDefaultAdmin();
    const c = await supertest(app).post('/usuarios').set('authorization', `Bearer ${tok(admin.id)}`)
      .send({ email: 'temp@x.com', nombre: 'Temp', password: 'secreto', rol: 'RECEPCIONISTA', duracionDias: 2 });
    expect(c.status).toBe(201);
    expect(c.body.expiraEn).toBeTruthy();
    const dias = (new Date(c.body.expiraEn).getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(1.9);
    expect(dias).toBeLessThan(2.1);

    const sinVenc = await supertest(app).post('/usuarios').set('authorization', `Bearer ${tok(admin.id)}`)
      .send({ email: 'perma@x.com', nombre: 'Perma', password: 'secreto', rol: 'RECEPCIONISTA' });
    expect(sinVenc.status).toBe(201);
    expect(sinVenc.body.expiraEn).toBeNull();

    const list = await supertest(app).get('/usuarios').set('authorization', `Bearer ${tok(admin.id)}`);
    expect(list.body.some((u: any) => u.email === 'temp@x.com' && u.expiraEn)).toBe(true);
  });

  it('extiende un vencido (lo reactiva) y no permite vencer al default', async () => {
    const admin = await seedDefaultAdmin();
    const v = await getPrisma().adminUser.create({ data: { email: 'reac@x.com', nombre: 'R', passwordHash: 'h', rol: 'RECEPCIONISTA', expiraEn: new Date(Date.now() - 1000) } });
    const ext = await supertest(app).patch(`/usuarios/${v.id}/expiracion`).set('authorization', `Bearer ${tok(admin.id)}`).send({ duracionDias: 7 });
    expect(ext.status).toBe(200);
    expect(new Date(ext.body.expiraEn).getTime()).toBeGreaterThan(Date.now());

    const quitar = await supertest(app).patch(`/usuarios/${v.id}/expiracion`).set('authorization', `Bearer ${tok(admin.id)}`).send({ duracionDias: null });
    expect(quitar.status).toBe(200);
    expect(quitar.body.expiraEn).toBeNull();

    const noDefault = await supertest(app).patch(`/usuarios/${admin.id}/expiracion`).set('authorization', `Bearer ${tok(admin.id)}`).send({ duracionDias: 2 });
    expect(noDefault.status).toBe(403);
  });

  it('no permite cambiar el vencimiento propio (aunque no sea default)', async () => {
    await seedDefaultAdmin();
    const otro = await getPrisma().adminUser.create({ data: { email: 'otro@x.com', nombre: 'Otro', passwordHash: 'h', rol: 'ADMIN' } });
    const propio = await supertest(app).patch(`/usuarios/${otro.id}/expiracion`).set('authorization', `Bearer ${tok(otro.id)}`).send({ duracionDias: 1 });
    expect(propio.status).toBe(403);
  });
});

describe('login con vencimiento', () => {
  it('rechaza al usuario vencido con 403 USUARIO_VENCIDO', async () => {
    const { hashPassword } = await import('../../src/utils/password.js');
    await getPrisma().adminUser.create({ data: { email: 'venc@x.com', nombre: 'V', passwordHash: await hashPassword('secreto'), rol: 'RECEPCIONISTA', expiraEn: new Date(Date.now() - 1000) } });
    const r = await supertest(app).post('/auth/login').send({ email: 'venc@x.com', password: 'secreto' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('USUARIO_VENCIDO');
  });

  it('deja entrar al no vencido y acota el token a expiraEn', async () => {
    const { hashPassword } = await import('../../src/utils/password.js');
    const expiraEn = new Date(Date.now() + 2 * 86_400_000);
    await getPrisma().adminUser.create({ data: { email: 'ok@x.com', nombre: 'O', passwordHash: await hashPassword('secreto'), rol: 'RECEPCIONISTA', expiraEn } });
    const r = await supertest(app).post('/auth/login').send({ email: 'ok@x.com', password: 'secreto' });
    expect(r.status).toBe(200);
    const payload = JSON.parse(Buffer.from(r.body.token.split('.')[1], 'base64').toString());
    // exp (segundos) debe caer cerca de expiraEn, no a 12h del JWT_EXPIRES_IN de tests.
    expect(Math.abs(payload.exp * 1000 - expiraEn.getTime())).toBeLessThan(5000);
  });
});
