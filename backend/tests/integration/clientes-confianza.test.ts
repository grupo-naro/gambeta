import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => { await resetTables(); canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 10000, jugadores: 5 } })).id; });

const admin = () => signAdminToken({ adminId: 'a', email: 'a@b.com', rol: 'ADMIN' });
// El default no es significativo (solo hace falta una fecha futura válida): se usa +2, con
// margen de sobra frente al corrimiento ART/UTC que a +7 puede caer fuera de la ventana de
// anticipación pública (estas reservas se crean con x-api-key, sin JWT de admin).
const fechaFutura = (d = 2) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const reservar = (over: Record<string, unknown> = {}) =>
  supertest(app).post('/reservas').set('x-api-key', 'svc').send({
    canchaId, whatsapp: '5491150000010', nombreCliente: 'Ana', esContacto: false,
    fecha: fechaFutura(), horaInicio: '18:00', ...over,
  });
// crea reservas CUMPLIDAS (CONFIRMADA) directas en la DB para el mismo cliente
async function cumplidas(n: number) {
  const cl = await getPrisma().cliente.upsert({ where: { whatsapp: '5491150000010' }, create: { whatsapp: '5491150000010', nombre: 'Ana' }, update: {} });
  for (let i = 0; i < n; i++) {
    await getPrisma().reserva.create({ data: { canchaId, clienteId: cl.id, estado: 'CONFIRMADA', esContacto: false, monto: 10000, fechaInicio: new Date(Date.now() - (i + 1) * 86400000), fechaFin: new Date(Date.now() - (i + 1) * 86400000 + 3600000) } });
  }
  return cl;
}

describe('seña desde la DB (clientes de confianza)', () => {
  it('cliente nuevo → ESPERANDO_SENA', async () => {
    const r = await reservar();
    expect(r.status).toBe(201);
    expect(r.body.estado).toBe('ESPERANDO_SENA');
  });
  it('cliente con 2 reservas cumplidas pero NO confiable → sigue ESPERANDO_SENA (ya no auto)', async () => {
    await cumplidas(2);
    const r = await reservar();
    expect(r.body.estado).toBe('ESPERANDO_SENA');
  });
  it('cliente con 1 cumplida → ESPERANDO_SENA', async () => {
    await cumplidas(1);
    const r = await reservar();
    expect(r.body.estado).toBe('ESPERANDO_SENA');
  });
  it('cliente marcado confiable → CONFIRMADA aunque no tenga cumplidas', async () => {
    await getPrisma().cliente.create({ data: { whatsapp: '5491150000011', nombre: 'Beto', confiable: true } });
    const r = await reservar({ whatsapp: '5491150000011', nombreCliente: 'Beto' });
    expect(r.body.estado).toBe('CONFIRMADA');
  });
});

describe('panel: GET /clientes + PATCH /clientes/:id', () => {
  it('GET /clientes devuelve cumplidas y confianza', async () => {
    const cl = await cumplidas(2);
    const r = await supertest(app).get('/clientes').set('authorization', `Bearer ${admin()}`);
    expect(r.status).toBe(200);
    const item = (r.body as any[]).find((c) => c.id === cl.id);
    expect(item.cumplidas).toBe(2);
    expect(item.confianza).toBe(false); // 2 cumplidas ya NO da confianza; solo el flag manual
  });
  it('PATCH /clientes/:id actualiza confiable y nombre', async () => {
    const cl = await getPrisma().cliente.create({ data: { whatsapp: '5491150000012', nombre: 'Caro' } });
    const r = await supertest(app).patch('/clientes/' + cl.id).set('authorization', `Bearer ${admin()}`).send({ confiable: true, nombre: 'Carolina' });
    expect(r.status).toBe(200);
    const after = await getPrisma().cliente.findUnique({ where: { id: cl.id } });
    expect(after!.confiable).toBe(true);
    expect(after!.nombre).toBe('Carolina');
    expect(after!.nombreConfirmado).toBe(true);
  });
  it('PATCH /clientes/:id inexistente → 404', async () => {
    const r = await supertest(app).patch('/clientes/noexiste').set('authorization', `Bearer ${admin()}`).send({ confiable: true });
    expect(r.status).toBe(404);
  });
});
