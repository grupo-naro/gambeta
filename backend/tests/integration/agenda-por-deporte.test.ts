import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(resetTables);

const fecha = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

/** Complejo abierto de 8 a 23, con franja pico de 18:00 al cierre (semana y finde). */
async function abrirDe8a23() {
  const { configService } = await import('../../src/services/config.service.js');
  await configService.get();
  await configService.update({
    horaApertura: '08:00', horaCierre: '23:00', horaAperturaFinde: '08:00', horaCierreFinde: '23:00',
    picoDesde: '18:00', picoHasta: '23:00', picoFindeDesde: '18:00', picoFindeHasta: '23:00',
  });
}

const crearCancha = (tipo: string, nombre: string) =>
  getPrisma().cancha.create({ data: { nombre, tipo, precioHora: 30000, precioHoraPico: 36000 } });

function reservar(canchaId: string, horaInicio: string, duracionMin?: number) {
  const body: Record<string, unknown> = { canchaId, fecha, horaInicio, whatsapp: '5491133334444', nombreCliente: 'Test', esContacto: true };
  if (duracionMin != null) body.duracionMin = duracionMin;
  return supertest(app).post('/reservas').set('x-api-key', 'svc').send(body);
}

describe('la agenda depende del deporte', () => {
  it('fútbol: los turnos arrancan solo en hora en punto', async () => {
    await abrirDe8a23();
    const c = await crearCancha('futbol5', 'Cancha 1');
    const { disponibilidadService } = await import('../../src/services/disponibilidad.service.js');
    const { slots } = await disponibilidadService.listar(c.id, fecha);
    const horas = slots.map((s) => s.horaInicio);
    expect(horas).toContain('18:00');
    expect(horas).not.toContain('18:30');
    expect(horas.every((h) => h.endsWith(':00'))).toBe(true);
  });

  it('fútbol: cada turno ofrece solo la duración de una hora', async () => {
    await abrirDe8a23();
    const c = await crearCancha('futbol7', 'Cancha 2');
    const { disponibilidadService } = await import('../../src/services/disponibilidad.service.js');
    const { slots } = await disponibilidadService.listar(c.id, fecha);
    const s18 = slots.find((s) => s.horaInicio === '18:00')!;
    expect(s18.duraciones.map((d) => d.min)).toEqual([60]);
    // El pico arranca a las 18:00 por defecto en los tests, pero acá lo que importa
    // es que exista una sola opción, no cuál es su precio.
    expect(s18.duraciones).toHaveLength(1);
  });

  it('pádel: conserva el paso de media hora y las tres duraciones', async () => {
    await abrirDe8a23();
    const c = await crearCancha('padel', 'Pádel 1');
    const { disponibilidadService } = await import('../../src/services/disponibilidad.service.js');
    const { slots } = await disponibilidadService.listar(c.id, fecha);
    const horas = slots.map((s) => s.horaInicio);
    expect(horas).toContain('18:00');
    expect(horas).toContain('18:30');
    const s18 = slots.find((s) => s.horaInicio === '18:00')!;
    expect(s18.duraciones.map((d) => d.min)).toEqual([60, 90, 120]);
  });
});

describe('el backend rechaza lo que la grilla no ofrece', () => {
  it('fútbol: una reserva de dos horas se rechaza aunque venga por API', async () => {
    await abrirDe8a23();
    const c = await crearCancha('futbol5', 'Cancha 1');
    // Sin este chequeo se podría saltear la grilla y crear el turno igual.
    expect((await reservar(c.id, '18:00', 120)).status).toBe(422);
    expect((await reservar(c.id, '18:00', 90)).status).toBe(422);
  });

  it('fútbol: una reserva que arranca a y media se rechaza', async () => {
    await abrirDe8a23();
    const c = await crearCancha('futbol5', 'Cancha 1');
    expect((await reservar(c.id, '18:30', 60)).status).toBe(422);
  });

  it('fútbol: la reserva de una hora en punto sigue funcionando, y el pico sigue siendo el único modificador', async () => {
    await abrirDe8a23();
    const c = await crearCancha('futbol5', 'Cancha 1');

    // Fuera de la franja pico: precio base.
    const base = await reservar(c.id, '10:00', 60);
    expect(base.status).toBe(201);
    expect(Number(base.body.monto)).toBe(30000);

    // Dentro de la franja pico: precio pico. Es el único modificador que aplica al fútbol.
    const pico = await reservar(c.id, '18:00', 60);
    expect(pico.status).toBe(201);
    expect(Number(pico.body.monto)).toBe(36000);
  });

  it('fútbol: el bot y n8n, que no mandan duracionMin, siguen andando', async () => {
    await abrirDe8a23();
    const c = await crearCancha('futbol5', 'Cancha 1');
    expect((await reservar(c.id, '19:00')).status).toBe(201);
  });

  it('pádel: las dos horas y el arranque a y media siguen permitidos', async () => {
    await abrirDe8a23();
    const c = await crearCancha('padel', 'Pádel 1');
    expect((await reservar(c.id, '18:00', 120)).status).toBe(201);
    expect((await reservar(c.id, '20:30', 90)).status).toBe(201);
  });
});
