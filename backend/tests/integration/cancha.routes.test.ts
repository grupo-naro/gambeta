import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('canchas', () => {
  it('creates and lists a cancha (admin)', async () => {
    const create = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'Cancha 1', tipo: 'futbol5', precioHora: 10000, jugadores: 5 });
    expect(create.status).toBe(201);
    expect(create.body.id).toBeTruthy();

    const list = await supertest(app).get('/canchas').set('authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  it('rejects unauthenticated create', async () => {
    const res = await supertest(app).post('/canchas').send({ nombre: 'x', tipo: 'y', precioHora: 1 });
    expect(res.status).toBe(401);
  });

  it('soft-deletes via PATCH activa', async () => {
    const c = await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`)
      .send({ nombre: 'C', tipo: 'futbol5', precioHora: 5000, jugadores: 5 });
    const res = await supertest(app).patch(`/canchas/${c.body.id}/activa`)
      .set('authorization', `Bearer ${token}`).send({ activa: false });
    expect(res.status).toBe(200);
    expect(res.body.activa).toBe(false);
  });

  it('persiste senaMonto en create y lo devuelve', async () => {
    const res = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'C sena', tipo: 'futbol', precioHora: 20000, jugadores: 5, senaMonto: 10000 });
    expect(res.status).toBe(201);
    expect(Number(res.body.senaMonto)).toBe(10000);
  });

  it('rechaza senaMonto negativo con 400', async () => {
    const res = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'C neg', tipo: 'futbol', precioHora: 20000, jugadores: 5, senaMonto: -5 });
    expect(res.status).toBe(400);
  });

  it('rechaza senaMonto mayor que el precio con 422', async () => {
    const res = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'C sena alta', tipo: 'futbol', precioHora: 8000, jugadores: 5, senaMonto: 10000 });
    expect(res.status).toBe(422);
  });

  it('acepta senaMonto igual al precio', async () => {
    const res = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'C sena igual', tipo: 'futbol', precioHora: 10000, jugadores: 5, senaMonto: 10000 });
    expect(res.status).toBe(201);
  });

  it('rechaza actualizar senaMonto por encima del precio con 422', async () => {
    const c = (await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`)
      .send({ nombre: 'C up', tipo: 'futbol', precioHora: 8000, jugadores: 5 })).body;
    const res = await supertest(app).patch(`/canchas/${c.id}`).set('authorization', `Bearer ${token}`)
      .send({ senaMonto: 12000 });
    expect(res.status).toBe(422);
  });
});

describe('Cancha destacada', () => {
  it('POST /canchas con destacada:true lo persiste y GET lo devuelve', async () => {
    const res = await supertest(app).post('/canchas').set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Techada', tipo: 'futbol5', precioHora: 1500, jugadores: 5, destacada: true });
    expect(res.status).toBe(201);
    expect(res.body.destacada).toBe(true);
    const list = await supertest(app).get('/canchas').set('x-api-key', 'svc');
    expect(list.body.find((c: any) => c.id === res.body.id).destacada).toBe(true);
  });

  it('POST /canchas sin destacada -> default false', async () => {
    const res = await supertest(app).post('/canchas').set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Comun', tipo: 'futbol5', precioHora: 1000, jugadores: 5 });
    expect(res.status).toBe(201);
    expect(res.body.destacada).toBe(false);
  });

  it('PATCH /canchas/:id con destacada:true lo actualiza', async () => {
    const created = await supertest(app).post('/canchas').set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'X', tipo: 'futbol5', precioHora: 1000, jugadores: 5 });
    const res = await supertest(app).patch(`/canchas/${created.body.id}`).set('Authorization', `Bearer ${token}`)
      .send({ destacada: true });
    expect(res.status).toBe(200);
    expect(res.body.destacada).toBe(true);
  });
});

describe('precioHoraPico', () => {
  it('persiste precioHoraPico en create', async () => {
    const res = await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`)
      .send({ nombre: 'CP', tipo: 'futbol5', precioHora: 1000, jugadores: 5, precioHoraPico: 1800 });
    expect(res.status).toBe(201);
    expect(Number(res.body.precioHoraPico)).toBe(1800);
  });
  it('rechaza precioHoraPico negativo con 400', async () => {
    const res = await supertest(app).post('/canchas').set('authorization', `Bearer ${token}`)
      .send({ nombre: 'CN', tipo: 'futbol5', precioHora: 1000, jugadores: 5, precioHoraPico: -5 });
    expect(res.status).toBe(400);
  });
});

describe('POST /canchas — jugadores', () => {
  it('crea una cancha con jugadores=7', async () => {
    const res = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'C7', tipo: 'futbol7', precioHora: 1000, jugadores: 7 });
    expect(res.status).toBe(201);
    expect(res.body.jugadores).toBe(7);
  });

  it('acepta jugadores=6 (fútbol 6)', async () => {
    const res = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'C6', tipo: 'futbol', precioHora: 1000, jugadores: 6 });
    expect(res.status).toBe(201);
    expect(res.body.jugadores).toBe(6);
  });

  it('acepta jugadores=0 (Otro / no fútbol)', async () => {
    const res = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'Padel 1', tipo: 'padel', precioHora: 1000, jugadores: 0 });
    expect(res.status).toBe(201);
    expect(res.body.jugadores).toBe(0);
  });

  it('rechaza jugadores=8 con 400', async () => {
    const res = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'C8', tipo: 'otro', precioHora: 1000, jugadores: 8 });
    expect(res.status).toBe(400);
  });

  it('rechaza la creacion sin jugadores con 400', async () => {
    const res = await supertest(app).post('/canchas')
      .set('authorization', `Bearer ${token}`)
      .send({ nombre: 'Sin jugadores', tipo: 'futbol5', precioHora: 1000 });
    expect(res.status).toBe(400);
  });
});
