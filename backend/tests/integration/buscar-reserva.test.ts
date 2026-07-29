import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'Cancha 2', tipo: 'futbol', precioHora: 12000, jugadores: 5 } })).id;
});

// 2026-07-08 (día fijo, futuro respecto a la data). Reserva 20:00 ART = 23:00Z.
async function reserva(nombre: string, iniUtc: string, estado: any = 'CONFIRMADA') {
  const cli = await getPrisma().cliente.create({ data: { whatsapp: '54911' + Math.floor(Math.random()*1e8), nombre } });
  const ini = new Date(iniUtc); const fin = new Date(ini.getTime() + 3600000);
  return getPrisma().reserva.create({ data: { canchaId, clienteId: cli.id, fechaInicio: ini, fechaFin: fin, estado, esContacto: false, monto: 12000 } });
}
const buscar = (q: string) => supertest(app).get('/reservas/buscar?' + q).set('x-api-key', 'svc');

describe('GET /reservas/buscar', () => {
  it('encuentra por nombre (parcial, sin acentos) + fecha', async () => {
    const r = await reserva('Julián Pérez', '2026-07-08T23:00:00.000Z');
    const res = await buscar('nombre=julian&fecha=2026-07-08');
    expect(res.status).toBe(200);
    expect(res.body.map((x: any) => x.id)).toContain(r.id);
    expect(res.body[0].clienteNombre).toBe('Julián Pérez');
    expect(res.body[0].horaInicio).toBe('20:00');
  });
  it('no devuelve canceladas ni de otro día', async () => {
    await reserva('Julián', '2026-07-08T23:00:00.000Z', 'CANCELADA');
    await reserva('Julián', '2026-07-09T23:00:00.000Z');
    const res = await buscar('nombre=julian&fecha=2026-07-08');
    expect(res.body.length).toBe(0);
  });
  it('filtra por cancha (número) y hora', async () => {
    await reserva('Julián', '2026-07-08T23:00:00.000Z');
    expect((await buscar('nombre=julian&fecha=2026-07-08&cancha=2')).body.length).toBe(1);
    expect((await buscar('nombre=julian&fecha=2026-07-08&cancha=5')).body.length).toBe(0);
    expect((await buscar('nombre=julian&fecha=2026-07-08&hora=20:00')).body.length).toBe(1);
    expect((await buscar('nombre=julian&fecha=2026-07-08&hora=21:00')).body.length).toBe(0);
  });
});
