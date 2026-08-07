import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any;
let tokenAdmin: string;

beforeAll(async () => {
  process.env.MP_CLIENT_ID = 'app-123';
  process.env.MP_CLIENT_SECRET = 'secreto-app';
  process.env.PANEL_PUBLIC_URL = 'https://panel.test';
  // Sin cuenta vinculada, crearPreferencia() tiene que fallar por falta de CUENTA, no por
  // faltarle estas dos: si no están seteadas, requerida() corta antes y el test de abajo
  // ("...falla con un mensaje claro") vería el mensaje equivocado.
  process.env.RESERVAS_PUBLIC_URL = 'https://reservas.test';
  process.env.BACKEND_PUBLIC_URL = 'https://api.test';
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const admin = await getPrisma().adminUser.create({
    data: { email: 'admin@test.com', passwordHash: 'x', nombre: 'Admin', rol: 'ADMIN' },
  });
  tokenAdmin = signAdminToken({ adminId: admin.id, email: admin.email, rol: 'ADMIN' });
});

describe('rutas de la cuenta de Mercado Pago', () => {
  it('el estado sin cuenta dice que no está vinculada', async () => {
    const res = await supertest(app).get('/pagos/mercadopago/cuenta').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.vinculada).toBe(false);
  });

  it('vincular devuelve la URL de autorización', async () => {
    const res = await supertest(app).post('/pagos/mercadopago/vincular').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('auth.mercadopago.com');
    expect(res.body.url).toContain('offline_access');
  });

  it('sin JWT de admin no se puede tocar nada', async () => {
    // Ojo: la service key NO alcanza. Vincular una cuenta redirige plata.
    expect((await supertest(app).get('/pagos/mercadopago/cuenta').set('x-api-key', 'svc')).status).toBe(401);
    expect((await supertest(app).post('/pagos/mercadopago/vincular').set('x-api-key', 'svc')).status).toBe(401);
    expect((await supertest(app).delete('/pagos/mercadopago/cuenta').set('x-api-key', 'svc')).status).toBe(401);
  });

  it('un state adulterado en el callback devuelve 400', async () => {
    const res = await supertest(app).post('/pagos/mercadopago/callback')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ code: 'x', state: 'inventado' });
    expect(res.status).toBe(400);
  });

  it('crear una preferencia sin cuenta vinculada falla con un mensaje claro', async () => {
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } });
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const reserva = await supertest(app).post('/reservas').set('x-api-key', 'svc').send({
      canchaId: cancha.id, whatsapp: '+5491150000000', nombreCliente: 'Juan',
      esContacto: false, fecha: manana, horaInicio: '18:00',
    });
    expect(reserva.status).toBe(201);

    const res = await supertest(app).post('/pagos/mercadopago/preferencia')
      .set('x-api-key', 'svc').send({ reservaId: reserva.body.id });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/cuenta de Mercado Pago/i);
  });

  it('datosPago informa que los cobros online están apagados', async () => {
    const res = await supertest(app).get('/config/sena').set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body.cobrosOnline).toBe(false);
  });
});
