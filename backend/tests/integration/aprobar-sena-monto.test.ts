import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  await getPrisma().configuracion.create({ data: { senaMontoFijo: 5000 } });
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'futbol', precioHora: 20000, jugadores: 5, senaMonto: 10000 } })).id;
});
const fut = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const crearEsperandoSena = (whatsapp: string) =>
  supertest(app).post('/reservas').set('x-api-key', 'svc')
    .send({ canchaId, whatsapp, nombreCliente: 'Nuevo', esContacto: false, fecha: fut(), horaInicio: '18:00' });

describe('aprobar-sena — monto detectado (sobrepago)', () => {
  it('registra el cobro por el monto detectado si es mayor a la seña esperada', async () => {
    const r = await crearEsperandoSena('+5491150000041');
    expect(r.body.estado).toBe('ESPERANDO_SENA');
    const ap = await supertest(app).patch(`/reservas/${r.body.id}/aprobar-sena`).set('x-api-key', 'svc').send({ montoDetectado: 18000 });
    expect(ap.status).toBe(200);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: r.body.id, origen: 'SENA' } });
    expect(cobros).toHaveLength(1);
    expect(Number(cobros[0].monto)).toBe(18000);
  });

  it('usa la seña esperada si no viene monto detectado', async () => {
    const r = await crearEsperandoSena('+5491150000042');
    const ap = await supertest(app).patch(`/reservas/${r.body.id}/aprobar-sena`).set('x-api-key', 'svc').send({});
    expect(ap.status).toBe(200);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: r.body.id, origen: 'SENA' } });
    expect(Number(cobros[0].monto)).toBe(10000);
  });

  it('no baja del esperado si el detectado es menor', async () => {
    const r = await crearEsperandoSena('+5491150000043');
    const ap = await supertest(app).patch(`/reservas/${r.body.id}/aprobar-sena`).set('x-api-key', 'svc').send({ montoDetectado: 7000 });
    expect(ap.status).toBe(200);
    const cobros = await getPrisma().cobro.findMany({ where: { reservaId: r.body.id, origen: 'SENA' } });
    expect(Number(cobros[0].monto)).toBe(10000);
  });
});
