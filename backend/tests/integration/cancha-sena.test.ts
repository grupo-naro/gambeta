import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  await getPrisma().configuracion.create({ data: { senaModo: 'PORCENTAJE', senaPorcentaje: 50, senaMontoFijo: 5000 } });
});

const reservaFutura = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

describe('seña por cancha', () => {
  it('usa el senaMonto de la cancha cuando está seteado', async () => {
    const c = await getPrisma().cancha.create({ data: { nombre: 'A', tipo: 'futbol', precioHora: 20000, jugadores: 5, senaMonto: 10000 } });
    canchaId = c.id;
    const r = await supertest(app).post('/reservas').set('x-api-key', 'svc')
      .send({ canchaId, whatsapp: '+5491150000021', nombreCliente: 'Nuevo', esContacto: false, fecha: reservaFutura(), horaInicio: '18:00' });
    expect(r.status).toBe(201);
    expect(r.body.estado).toBe('ESPERANDO_SENA');
    expect(Number(r.body.montoSena)).toBe(10000);
  });

  it('cae al monto fijo global (NO porcentaje) cuando la cancha no tiene senaMonto', async () => {
    const c = await getPrisma().cancha.create({ data: { nombre: 'B', tipo: 'futbol', precioHora: 20000, jugadores: 5 } });
    const r = await supertest(app).post('/reservas').set('x-api-key', 'svc')
      .send({ canchaId: c.id, whatsapp: '+5491150000022', nombreCliente: 'Nuevo2', esContacto: false, fecha: reservaFutura(), horaInicio: '19:00' });
    expect(r.status).toBe(201);
    expect(r.body.estado).toBe('ESPERANDO_SENA');
    expect(Number(r.body.montoSena)).toBe(5000);
  });
});
