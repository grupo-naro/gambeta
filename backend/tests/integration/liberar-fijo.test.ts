import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 10000, jugadores: 5 } })).id;
});

const WA = '+5491150000020';
// 2026-06-17 es MIÉRCOLES (diaSemana 3, 0=Dom). 2026-06-18 es JUEVES (4).
async function fijoMiercoles() {
  return getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Pepe', whatsapp: WA, diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', precio: 10000, activo: true } });
}
const liberar = (body: Record<string, unknown>) => supertest(app).post('/turnos-fijos/liberar').set('x-api-key', 'svc').send(body);

describe('POST /turnos-fijos/liberar', () => {
  it('libera el fijo del whatsapp cuando el día coincide', async () => {
    const f = await fijoMiercoles();
    const r = await liberar({ whatsapp: WA, fecha: '2026-06-17' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ liberado: true, cantidad: 1 });
    const exc = await getPrisma().turnoFijoExcepcion.findMany({ where: { turnoFijoId: f.id } });
    expect(exc.length).toBe(1);
  });
  it('no libera si el día no coincide con el fijo', async () => {
    await fijoMiercoles();
    const r = await liberar({ whatsapp: WA, fecha: '2026-06-18' }); // jueves
    expect(r.body).toMatchObject({ liberado: false, cantidad: 0 });
  });
  it('whatsapp sin fijo → liberado false', async () => {
    const r = await liberar({ whatsapp: '+5491159999999', fecha: '2026-06-17' });
    expect(r.body).toMatchObject({ liberado: false });
  });
  it('matchea aunque el formato del whatsapp difiera (panel "+54..." sin 9 vs bot "549...")', async () => {
    // Como lo carga una persona en el panel: con +, sin el 9 de celular.
    const f = await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Naro', whatsapp: '+541136620274', diaSemana: 3, horaInicio: '19:00', horaFin: '20:00', precio: 10000, activo: true } });
    // Como lo manda el bot (JID de WhatsApp: con 9, sin +).
    const r = await liberar({ whatsapp: '5491136620274', fecha: '2026-06-17' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ liberado: true, cantidad: 1 });
    const exc = await getPrisma().turnoFijoExcepcion.findMany({ where: { turnoFijoId: f.id } });
    expect(exc.length).toBe(1);
  });
  it('no over-matchea: el fijo de otro numero no se libera', async () => {
    await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Otro', whatsapp: '+5491150000099', diaSemana: 3, horaInicio: '18:00', horaFin: '19:00', precio: 10000, activo: true } });
    const r = await liberar({ whatsapp: '5491136620274', fecha: '2026-06-17' });
    expect(r.body).toMatchObject({ liberado: false, cantidad: 0 });
  });
  it('idempotente: liberar dos veces no duplica ni falla', async () => {
    const f = await fijoMiercoles();
    await liberar({ whatsapp: WA, fecha: '2026-06-17' });
    const r2 = await liberar({ whatsapp: WA, fecha: '2026-06-17' });
    expect(r2.body).toMatchObject({ liberado: true });
    const exc = await getPrisma().turnoFijoExcepcion.findMany({ where: { turnoFijoId: f.id } });
    expect(exc.length).toBe(1);
  });
});
