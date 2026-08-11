import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

const KEY = 'buffet-key-de-prueba-1234567890';
let app: any; let token: string;

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('buffet: PIN del mostrador', () => {
  it('sin PIN configurado, verificar devuelve 401 (no deja entrar a nadie)', async () => {
    const r = await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin: '1234' });
    expect(r.status).toBe(401);
  });

  it('el admin setea el PIN del principal y ese mostrador lo verifica', async () => {
    const s = await supertest(app).put('/buffet/pin').set('authorization', `Bearer ${token}`)
      .send({ pin: '4321', mostradorId: 'mostrador-principal' });
    expect(s.status).toBe(204);

    const ok = await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin: '4321' });
    expect(ok.status).toBe(200);
    expect(ok.body.tipo).toBe('PRINCIPAL');
    expect(ok.body.token).toBeTruthy();

    const mal = await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin: '0000' });
    expect(mal.status).toBe(401);
  });

  it('el PIN se guarda hasheado, nunca en claro', async () => {
    await supertest(app).put('/buffet/pin').set('authorization', `Bearer ${token}`)
      .send({ pin: '4321', mostradorId: 'mostrador-principal' });
    const cfg = await supertest(app).get('/config').set('authorization', `Bearer ${token}`);
    expect(JSON.stringify(cfg.body)).not.toContain('4321');
  });

  it('el PIN debe tener 4 digitos', async () => {
    const a = await supertest(app).put('/buffet/pin').set('authorization', `Bearer ${token}`)
      .send({ pin: '12', mostradorId: 'mostrador-principal' });
    expect(a.status).toBe(400);
    const b = await supertest(app).put('/buffet/pin').set('authorization', `Bearer ${token}`)
      .send({ pin: 'abcd', mostradorId: 'mostrador-principal' });
    expect(b.status).toBe(400);
  });

  it('el mostradorId debe ser uno de los dos existentes', async () => {
    const r = await supertest(app).put('/buffet/pin').set('authorization', `Bearer ${token}`)
      .send({ pin: '4321', mostradorId: 'mostrador-que-no-existe' });
    expect(r.status).toBe(400);
  });

  it('la buffet-key no puede setear el PIN', async () => {
    const r = await supertest(app).put('/buffet/pin').set('x-buffet-key', KEY)
      .send({ pin: '4321', mostradorId: 'mostrador-principal' });
    expect(r.status).toBe(401);
  });

  it('un RECEPCIONISTA no puede setear el PIN (403), un ADMIN si puede', async () => {
    const recepToken = signAdminToken({ adminId: 'y', email: 'r@b.com', rol: 'RECEPCIONISTA' });
    const r = await supertest(app).put('/buffet/pin').set('authorization', `Bearer ${recepToken}`)
      .send({ pin: '4321', mostradorId: 'mostrador-principal' });
    expect(r.status).toBe(403);

    const a = await supertest(app).put('/buffet/pin').set('authorization', `Bearer ${token}`)
      .send({ pin: '4321', mostradorId: 'mostrador-principal' });
    expect(a.status).toBe(204);
  });

  it('setear el PIN del secundario no toca el del principal', async () => {
    await supertest(app).put('/buffet/pin').set('authorization', `Bearer ${token}`)
      .send({ pin: '1111', mostradorId: 'mostrador-principal' });
    await supertest(app).put('/buffet/pin').set('authorization', `Bearer ${token}`)
      .send({ pin: '2222', mostradorId: 'mostrador-secundario' });

    const principal = await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin: '1111' });
    expect(principal.body.tipo).toBe('PRINCIPAL');
    const secundario = await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin: '2222' });
    expect(secundario.body.tipo).toBe('SECUNDARIO');
  });
});
