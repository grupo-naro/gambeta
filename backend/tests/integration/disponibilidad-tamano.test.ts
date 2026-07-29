import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { configService } from '../../src/services/config.service.js';

let app: any;
let cA: string; let cB: string;
let sectorB: string;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

beforeEach(async () => {
  await resetTables();
  // Dos canchas de 5; una de 11 (no debe aparecer al pedir 5)
  const a = await getPrisma().cancha.create({ data: { nombre: 'A5', tipo: 'f5', precioHora: 1000, jugadores: 5 } });
  const b = await getPrisma().cancha.create({ data: { nombre: 'B5', tipo: 'f5', precioHora: 1000, jugadores: 5 } });
  await getPrisma().cancha.create({ data: { nombre: 'C11', tipo: 'f11', precioHora: 2000, jugadores: 11 } });
  cA = a.id; cB = b.id;
  for (const id of [cA, cB]) {
    const s = await getPrisma().sector.create({ data: { nombre: 's' + id } });
    if (id === cB) sectorB = s.id;
    await getPrisma().canchaSector.create({ data: { canchaId: id, sectorId: s.id } });
  }
  await configService.get();
  await configService.update({ horaApertura: '18:00', horaCierre: '21:00' }); // 3 slots
});

describe('GET /disponibilidad/por-tamano', () => {
  it('agrupa por hora las canchas libres del tamaño pedido', async () => {
    const res = await supertest(app).get('/disponibilidad/por-tamano?jugadores=5&fecha=2026-06-12').set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body.jugadores).toBe(5);
    expect(res.body.slots).toHaveLength(3);
    // a las 18:00 ambas canchas de 5 están libres; la de 11 nunca aparece
    expect(res.body.slots[0].canchas.map((c: any) => c.nombre).sort()).toEqual(['A5', 'B5']);
  });

  it('una hora ocupada en una cancha deja solo la otra; ninguna libre => no aparece la hora', async () => {
    const cl = await getPrisma().cliente.create({ data: { nombre: 'J', whatsapp: '+1' } });
    // Ocupar B5 a las 18:00 ART (=21:00 UTC) — queda solo A5 a esa hora
    const r = await getPrisma().reserva.create({
      data: { canchaId: cB, clienteId: cl.id, estado: 'CONFIRMADA', esContacto: true, monto: 1000,
        fechaInicio: new Date('2026-06-12T21:00:00.000Z'), fechaFin: new Date('2026-06-12T22:00:00.000Z') },
    });
    await getPrisma().reservaSector.create({
      data: { reservaId: r.id, sectorId: sectorB, estado: 'CONFIRMADA',
        fechaInicio: new Date('2026-06-12T21:00:00.000Z'), fechaFin: new Date('2026-06-12T22:00:00.000Z') },
    });
    const res = await supertest(app).get('/disponibilidad/por-tamano?jugadores=5&fecha=2026-06-12').set('x-api-key', 'svc');
    const s18 = res.body.slots.find((s: any) => s.horaInicio === '18:00');
    expect(s18.canchas.map((c: any) => c.nombre)).toEqual(['A5']);
    // las otras horas siguen con ambas
    const s19 = res.body.slots.find((s: any) => s.horaInicio === '19:00');
    expect(s19.canchas).toHaveLength(2);
  });

  it('rechaza jugadores=6 con 400', async () => {
    const res = await supertest(app).get('/disponibilidad/por-tamano?jugadores=6&fecha=2026-06-12').set('x-api-key', 'svc');
    expect(res.status).toBe(400);
  });

  it('devuelve slots vacíos cuando no existen canchas del tamaño pedido', async () => {
    const res = await supertest(app).get('/disponibilidad/por-tamano?jugadores=9&fecha=2026-06-12').set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body.slots).toEqual([]);
  });

  it('usa horario de semana/finde con cierre a medianoche', async () => {
    await configService.update({
      horaApertura: '09:00', horaCierre: '00:00',
      horaAperturaFinde: '16:00', horaCierreFinde: '00:00',
    });
    // Buscamos fechas futuras concretas cuyo weekday (UTC, YYYY-MM-DD sin componente horario) sea martes/sábado.
    const proximoDia = (targetDow: number): string => {
      let d = new Date(Date.now() + 24 * 60 * 60 * 1000);
      while (d.getUTCDay() !== targetDow) d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
      return d.toISOString().slice(0, 10);
    };
    const martes = proximoDia(2);
    const sabado = proximoDia(6);

    // martes (semana 09-00): primer slot 09:00, último 23:00
    const rMar = await supertest(app).get(`/disponibilidad/por-tamano?jugadores=5&fecha=${martes}`).set('x-api-key', 'svc');
    expect(rMar.status).toBe(200);
    expect(rMar.body.slots[0].horaInicio).toBe('09:00');
    expect(rMar.body.slots[rMar.body.slots.length - 1].horaInicio).toBe('23:00');

    // sábado (finde 16-00): primer slot 16:00, no hay 09:00, último 23:00
    const rSab = await supertest(app).get(`/disponibilidad/por-tamano?jugadores=5&fecha=${sabado}`).set('x-api-key', 'svc');
    expect(rSab.status).toBe(200);
    expect(rSab.body.slots[0].horaInicio).toBe('16:00');
    expect(rSab.body.slots.some((s: any) => s.horaInicio === '09:00')).toBe(false);
    expect(rSab.body.slots[rSab.body.slots.length - 1].horaInicio).toBe('23:00');
  });
});
