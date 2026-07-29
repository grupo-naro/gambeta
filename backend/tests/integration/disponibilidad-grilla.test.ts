import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { configService } from '../../src/services/config.service.js';

let app: any;
let f1: string; let f2: string; let sectorF2: string;

beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  const a = await getPrisma().cancha.create({ data: { nombre: 'Futbol 1', tipo: 'futbol5', precioHora: 1000, jugadores: 5 } });
  const b = await getPrisma().cancha.create({ data: { nombre: 'Futbol 2', tipo: 'futbol7', precioHora: 2000, jugadores: 7 } });
  await getPrisma().cancha.create({ data: { nombre: 'Padel 1', tipo: 'padel', precioHora: 800, jugadores: 4 } });
  f1 = a.id; f2 = b.id;
  for (const id of [f1, f2]) {
    const s = await getPrisma().sector.create({ data: { nombre: 's' + id } });
    if (id === f2) sectorF2 = s.id;
    await getPrisma().canchaSector.create({ data: { canchaId: id, sectorId: s.id } });
  }
  // Padel también necesita sector para que listar funcione
  const sp = await getPrisma().sector.create({ data: { nombre: 'sp' } });
  const padel = await getPrisma().cancha.findFirst({ where: { tipo: 'padel' } });
  await getPrisma().canchaSector.create({ data: { canchaId: padel!.id, sectorId: sp.id } });
  await configService.get();
  await configService.update({ horaApertura: '18:00', horaCierre: '21:00' }); // 18,19,20
});

const mostrador = (r: any) => r.set('x-api-key', 'svc');

describe('GET /disponibilidad/grilla', () => {
  it('futbol: incluye solo canchas de futbol, con horas y libres', async () => {
    const res = await mostrador(supertest(app).get('/disponibilidad/grilla?deporte=futbol&fecha=2099-06-12'));
    expect(res.status).toBe(200);
    expect(res.body.canchas.map((c: any) => c.nombre).sort()).toEqual(['Futbol 1', 'Futbol 2']);
    expect(res.body.horas).toEqual(['18:00', '19:00', '20:00']);
    expect(res.body.libres[f1]['18:00']).toBe(true);
    expect(res.body.canchas.find((c: any) => c.nombre === 'Futbol 1').precioHora).toBe(1000);
    expect(res.body.canchas.find((c: any) => c.nombre === 'Futbol 2').precioHora).toBe(2000);
  });

  it('una celda ocupada queda en false', async () => {
    const cl = await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
    const r = await getPrisma().reserva.create({ data: { canchaId: f2, clienteId: cl.id, estado: 'CONFIRMADA', esContacto: true, monto: 2000, fechaInicio: new Date('2099-06-12T21:00:00.000Z'), fechaFin: new Date('2099-06-12T22:00:00.000Z') } });
    await getPrisma().reservaSector.create({ data: { reservaId: r.id, sectorId: sectorF2, estado: 'CONFIRMADA', fechaInicio: new Date('2099-06-12T21:00:00.000Z'), fechaFin: new Date('2099-06-12T22:00:00.000Z') } });
    const res = await mostrador(supertest(app).get('/disponibilidad/grilla?deporte=futbol&fecha=2099-06-12'));
    expect(res.body.libres[f2]['18:00']).toBe(false); // 18:00 ART = 21:00 UTC, ocupado
    expect(res.body.libres[f1]['18:00']).toBe(true);  // la otra cancha libre
  });

  it('padel devuelve solo la cancha de padel', async () => {
    const res = await mostrador(supertest(app).get('/disponibilidad/grilla?deporte=padel&fecha=2099-06-12'));
    expect(res.body.canchas.map((c: any) => c.nombre)).toEqual(['Padel 1']);
  });

  it('deporte inválido devuelve 400', async () => {
    const res = await mostrador(supertest(app).get('/disponibilidad/grilla?deporte=tenis&fecha=2099-06-12'));
    expect(res.status).toBe(400);
  });

  it('para hoy no muestra horarios ya pasados', async () => {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
    // Ventana amplia arrancando 00:00: la hora 00:00 de hoy siempre está en el pasado.
    // Se fijan semana y finde por igual porque "hoy" puede caer cualquier día.
    await configService.update({ horaApertura: '00:00', horaCierre: '23:00', horaAperturaFinde: '00:00', horaCierreFinde: '23:00' });
    const res = await mostrador(supertest(app).get(`/disponibilidad/grilla?deporte=futbol&fecha=${hoy}`));
    expect(res.status).toBe(200);
    expect(res.body.horas).not.toContain('00:00'); // 00:00 de hoy ya pasó → no figura
  });

  it('precios: refleja el precio efectivo (base fuera del pico, pico dentro)', async () => {
    // f1 = Futbol 1 (base 1000). Le damos precio pico y una ventana de pico.
    await getPrisma().cancha.update({ where: { id: f1 }, data: { precioHora: 1000, precioHoraPico: 3000 } });
    await configService.update({ picoDesde: '19:00', picoHasta: '21:00' }); // pico de semana 19-21
    // 2099-06-12 es viernes (día de semana); ventana 18-21 → horas 18,19,20
    const res = await mostrador(supertest(app).get('/disponibilidad/grilla?deporte=futbol&fecha=2099-06-12'));
    expect(res.status).toBe(200);
    expect(res.body.precios[f1]['18:00']).toBe(1000); // fuera del pico → base
    expect(res.body.precios[f1]['19:00']).toBe(3000); // dentro del pico → pico
    expect(res.body.precios[f1]['20:00']).toBe(3000);
  });
});
