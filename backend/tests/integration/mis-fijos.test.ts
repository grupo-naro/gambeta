import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string; let canchaBId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'Cancha 1', tipo: 'f5', precioHora: 10000, jugadores: 5 } })).id;
  canchaBId = (await getPrisma().cancha.create({ data: { nombre: 'Cancha 2', tipo: 'f5', precioHora: 12000, jugadores: 5 } })).id;
});

const mios = (whatsapp?: string) =>
  supertest(app).get('/turnos-fijos/mios' + (whatsapp === undefined ? '' : `?whatsapp=${encodeURIComponent(whatsapp)}`)).set('x-api-key', 'svc');

describe('GET /turnos-fijos/mios', () => {
  it('devuelve los fijos activos del whatsapp (match por ultimos 10 digitos), con cancha y precio numerico', async () => {
    // Cargado en el panel como "+54 sin 9"; el bot consulta con "549..." (con 9, sin +).
    const f = await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '+541136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', precio: 18000, activo: true } });
    const r = await mios('5491136620274');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ id: f.id, diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', canchaNombre: 'Cancha 1', precio: 18000 });
    expect(typeof r.body[0].precio).toBe('number');
  });

  it('matchea con los 10 digitos locales (sin prefijo)', async () => {
    await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '+541136620274', diaSemana: 1, horaInicio: '19:00', horaFin: '20:00', precio: 18000, activo: true } });
    const r = await mios('1136620274');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
  });

  it('ordena por diaSemana y luego horaInicio', async () => {
    const wa = '+541136620274';
    await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: wa, diaSemana: 5, horaInicio: '18:00', horaFin: '19:00', precio: 1000, activo: true } });
    await getPrisma().turnoFijo.create({ data: { canchaId: canchaBId, clienteNombre: 'Naro', whatsapp: wa, diaSemana: 1, horaInicio: '21:00', horaFin: '22:00', precio: 2000, activo: true } });
    await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: wa, diaSemana: 1, horaInicio: '08:00', horaFin: '09:00', precio: 3000, activo: true } });
    const r = await mios('5491136620274');
    expect(r.body.map((f: any) => [f.diaSemana, f.horaInicio])).toEqual([[1, '08:00'], [1, '21:00'], [5, '18:00']]);
  });

  it('excluye fijos inactivos', async () => {
    await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '+541136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', precio: 18000, activo: false } });
    const r = await mios('5491136620274');
    expect(r.body).toHaveLength(0);
  });

  it('no over-matchea: el fijo de otro numero no aparece', async () => {
    await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Otro', whatsapp: '+5491150000099', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', precio: 18000, activo: true } });
    const r = await mios('5491136620274');
    expect(r.body).toHaveLength(0);
  });

  it('fijo con precio null devuelve precio: null', async () => {
    await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '+541136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', activo: true } });
    const r = await mios('5491136620274');
    expect(r.body[0].precio).toBeNull();
  });

  it('falta whatsapp -> 400', async () => {
    const r = await mios();
    expect(r.status).toBe(400);
  });
});
