import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('GET /clientes/buscar', () => {
  it('devuelve el cliente por whatsapp con nombreConfirmado', async () => {
    await getPrisma().cliente.create({ data: { whatsapp: '+5491150000000', nombre: 'Daniel', nombreConfirmado: true } });
    const r = await supertest(app).get('/clientes/buscar?whatsapp=' + encodeURIComponent('+5491150000000')).set('x-api-key', 'svc');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ nombre: 'Daniel', nombreConfirmado: true });
    expect(typeof r.body.id).toBe('string');
  });
  it('devuelve null si no existe', async () => {
    const r = await supertest(app).get('/clientes/buscar?whatsapp=%2B5491150009999').set('x-api-key', 'svc');
    expect(r.status).toBe(200);
    expect(r.body).toBeNull();
  });
  it('400 si falta whatsapp', async () => {
    const r = await supertest(app).get('/clientes/buscar').set('x-api-key', 'svc');
    expect(r.status).toBe(400);
  });
});

describe('POST /reservas — nombreConfirmado', () => {
  async function cancha() {
    return (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 10000, jugadores: 5 } })).id;
  }
  const fechaFutura = () => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const reservar = (canchaId: string, over: Record<string, unknown>) =>
    supertest(app).post('/reservas').set('x-api-key', 'svc').send({
      canchaId, whatsapp: '+5491150000001', nombreCliente: 'X', esContacto: true,
      fecha: fechaFutura(), horaInicio: '18:00', ...over,
    });

  it('crea el cliente con nombreConfirmado=true cuando se envía', async () => {
    const c = await cancha();
    const r = await reservar(c, { nombreCliente: 'Daniel', nombreConfirmado: true });
    expect(r.status).toBe(201);
    const b = await supertest(app).get('/clientes/buscar?whatsapp=5491150000001').set('x-api-key', 'svc');
    expect(b.body).toMatchObject({ nombre: 'Daniel', nombreConfirmado: true });
  });

  it('NO pisa un nombre confirmado con uno sin confirmar', async () => {
    const c = await cancha();
    await reservar(c, { nombreCliente: 'Daniel', nombreConfirmado: true, horaInicio: '18:00' });
    await reservar(c, { nombreCliente: 'Publicidad Naro', nombreConfirmado: false, horaInicio: '19:00' });
    const b = await supertest(app).get('/clientes/buscar?whatsapp=5491150000001').set('x-api-key', 'svc');
    expect(b.body).toMatchObject({ nombre: 'Daniel', nombreConfirmado: true });
  });
});
