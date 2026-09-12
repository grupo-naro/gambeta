import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { dataSemana, diasSemanaActual } from '../../src/services/sheets/sheetsData.js';
import { instanteDeJornada, minutoDeJornada } from '../../src/utils/tz.js';

const TZ = 'America/Argentina/Buenos_Aires';

beforeAll(setupTestDb);
afterAll(teardownTestDb);

// Hallazgo 6 de la revisión final del plan de jornada del complejo: sheetsData.ts ubicaba las
// reservas reales por día CALENDARIO del instante (partesEnTz), mientras que el turno fijo
// equivalente (antes de materializarse) se ubica por diaSemana (=jornada) en expandirSemana.
// Con cierre de madrugada, una reserva de las 00:00 "saltaba" de día apenas se materializaba.
describe('dataSemana ubica las reservas por jornada, no por día calendario', () => {
  let canchaId: string; let clienteId: string;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Miércoles a mediodía ART: lejos de cualquier borde de medianoche, para que "hoy" no
    // interfiera con los instantes de madrugada que arman los casos de este archivo.
    vi.setSystemTime(new Date('2026-09-16T15:00:00.000Z'));

    await resetTables();
    const p = getPrisma();
    await p.configuracion.upsert({
      where: { id: 'default' },
      create: { id: 'default', horaApertura: '07:00', horaCierre: '01:00', horaAperturaFinde: '07:00', horaCierreFinde: '01:00', diasAnticipacionMax: 40 },
      update: { horaApertura: '07:00', horaCierre: '01:00', horaAperturaFinde: '07:00', horaCierreFinde: '01:00', diasAnticipacionMax: 40 },
    });
    const c = await p.cancha.create({ data: { nombre: 'C1', tipo: 'futbol', precioHora: 12000 } });
    canchaId = c.id;
    const cli = await p.cliente.create({ data: { nombre: 'Naro', whatsapp: '+5491100000000' } });
    clienteId = cli.id;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('una reserva de las 00:00 de la jornada del viernes cae en la celda VIERNES/00:00, no sábado', async () => {
    const p = getPrisma();
    const dias = diasSemanaActual(); // [LUNES..DOMINGO]
    const viernes = dias.find((d) => d.dia === 'VIERNES')!.fecha;
    const iniMin = minutoDeJornada('00:00', '07:00'); // 1440: madrugada del sábado calendario
    const fechaInicio = instanteDeJornada(viernes, iniMin, TZ);
    const fechaFin = instanteDeJornada(viernes, iniMin + 60, TZ);

    await p.reserva.create({
      data: { canchaId, clienteId, estado: 'CONFIRMADA', esContacto: true, monto: 12000, fechaInicio, fechaFin },
    });

    const { celdas } = await dataSemana();
    const celda = celdas.find((c) => c.canchaId === canchaId && c.tipo === 'suelto');
    expect(celda).toBeDefined();
    expect(celda!.fecha).toBe(viernes);
    expect(celda!.hora).toBe('00:00');
  });

  it('si esa jornada es la del último día de la semana, sigue apareciendo en esa semana (no en la siguiente)', async () => {
    const p = getPrisma();
    const dias = diasSemanaActual();
    const domingo = dias.find((d) => d.dia === 'DOMINGO')!.fecha;
    const iniMin = minutoDeJornada('00:00', '07:00'); // madrugada del lunes calendario SIGUIENTE
    const fechaInicio = instanteDeJornada(domingo, iniMin, TZ);
    const fechaFin = instanteDeJornada(domingo, iniMin + 60, TZ);

    await p.reserva.create({
      data: { canchaId, clienteId, estado: 'CONFIRMADA', esContacto: true, monto: 12000, fechaInicio, fechaFin },
    });

    const { celdas } = await dataSemana();
    const celda = celdas.find((c) => c.canchaId === canchaId && c.tipo === 'suelto');
    expect(celda).toBeDefined();
    expect(celda!.fecha).toBe(domingo);
    expect(celda!.hora).toBe('00:00');
  });

  it('regresión: una reserva normal (19:00) sigue ubicándose en su propio día calendario', async () => {
    const p = getPrisma();
    const dias = diasSemanaActual();
    const miercoles = dias.find((d) => d.dia === 'MIERCOLES')!.fecha;
    const fechaInicio = instanteDeJornada(miercoles, minutoDeJornada('19:00', '07:00'), TZ);
    const fechaFin = instanteDeJornada(miercoles, minutoDeJornada('20:00', '07:00'), TZ);

    await p.reserva.create({
      data: { canchaId, clienteId, estado: 'CONFIRMADA', esContacto: true, monto: 12000, fechaInicio, fechaFin },
    });

    const { celdas } = await dataSemana();
    const celda = celdas.find((c) => c.canchaId === canchaId && c.tipo === 'suelto');
    expect(celda).toBeDefined();
    expect(celda!.fecha).toBe(miercoles);
    expect(celda!.hora).toBe('19:00');
  });
});
