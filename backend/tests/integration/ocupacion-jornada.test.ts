import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { ocupacionService } from '../../src/services/ocupacion.service.js';
import { sumarDias } from '../../src/utils/tz.js';

let canchaId: string; let sectorId: string;
beforeAll(setupTestDb);
afterAll(teardownTestDb);

const EN_30 = new Date(Date.now() + 30 * 86400000);
const FECHA = EN_30.toISOString().slice(0, 10);
const DIA = new Date(FECHA + 'T12:00:00.000Z').getUTCDay();
const FECHA_SIG = sumarDias(FECHA, 1);

beforeEach(async () => {
  await resetTables();
  const p = getPrisma();
  await p.configuracion.upsert({
    where: { id: 'default' },
    create: { id: 'default', horaApertura: '07:00', horaCierre: '01:00', horaAperturaFinde: '07:00', horaCierreFinde: '01:00' },
    update: { horaApertura: '07:00', horaCierre: '01:00', horaAperturaFinde: '07:00', horaCierreFinde: '01:00' },
  });
  const c = await p.cancha.create({ data: { nombre: 'C1', tipo: 'padel', precioHora: 30000 } });
  canchaId = c.id;
  const s = await p.sector.create({ data: { nombre: 'S1' } });
  sectorId = s.id;
  await p.canchaSector.create({ data: { canchaId, sectorId } });
});

describe('ocupación en una jornada que cierra a la 01:00', () => {
  it('un fijo de 23:00 a 01:00 ocupa [1380, 1500), no un rango negativo', async () => {
    await getPrisma().turnoFijo.create({
      data: { canchaId, clienteNombre: 'Juan', diaSemana: DIA, horaInicio: '23:00', horaFin: '01:00', activo: true },
    });
    const rangos = await ocupacionService.rangosPlantilla(canchaId, FECHA);
    expect(rangos[0]).toMatchObject({ ini: 1380, fin: 1500, tipo: 'fijo' });
  });

  it('un fijo de 00:00 a 01:00 ocupa [1440, 1500)', async () => {
    await getPrisma().turnoFijo.create({
      data: { canchaId, clienteNombre: 'Ana', diaSemana: DIA, horaInicio: '00:00', horaFin: '01:00', activo: true },
    });
    const rangos = await ocupacionService.rangosPlantilla(canchaId, FECHA);
    expect(rangos[0]).toMatchObject({ ini: 1440, fin: 1500, tipo: 'fijo' });
  });

  it('ese fijo choca con un turno de las 00:00 y no con uno de las 23:00', async () => {
    await getPrisma().turnoFijo.create({
      data: { canchaId, clienteNombre: 'Ana', diaSemana: DIA, horaInicio: '00:00', horaFin: '01:00', activo: true },
    });
    expect(await ocupacionService.conflictoReserva(canchaId, FECHA, 1440, 1500)).toBe('fijo');
    expect(await ocupacionService.conflictoReserva(canchaId, FECHA, 1380, 1440)).toBeNull();
  });

  it('un bloqueo de 00:00 a 01:00 también ocupa su rango', async () => {
    await getPrisma().bloqueo.create({
      data: { canchaId, motivo: 'MANTENIMIENTO', recurrente: true, diaSemana: DIA, horaInicio: '00:00', horaFin: '01:00', activo: true },
    });
    const rangos = await ocupacionService.rangosPlantilla(canchaId, FECHA);
    expect(rangos[0]).toMatchObject({ ini: 1440, fin: 1500, tipo: 'bloqueo' });
  });
});

describe('conflictoAlCrear compara contra reservas reales en términos de jornada', () => {
  // Una reserva real del 00:00 a la 01:00 del día calendario SIGUIENTE a FECHA (madrugada) es,
  // por la regla de jornada, del mismo turno que un fijo "FECHA 00:00-01:00": diaSemana/fecha se
  // refieren a la jornada, no al día calendario del instante. Un fijo "viernes 00:00-01:00" se
  // juega la madrugada del sábado y pertenece al viernes: si esta reserva quedara "vista" como
  // sábado, un admin podría crear ese fijo encima de una cancha ya vendida sin que nada lo avise.
  async function crearReservaMadrugada() {
    const p = getPrisma();
    const cli = await p.cliente.create({ data: { nombre: 'Ana', whatsapp: '+5491150000002' } });
    const inicio = new Date(`${FECHA_SIG}T00:00:00.000-03:00`);
    const fin = new Date(`${FECHA_SIG}T01:00:00.000-03:00`);
    const r = await p.reserva.create({
      data: { canchaId, clienteId: cli.id, estado: 'CONFIRMADA', esContacto: false, monto: 30000, fechaInicio: inicio, fechaFin: fin },
    });
    await p.reservaSector.create({
      data: { reservaId: r.id, sectorId, estado: 'CONFIRMADA', fechaInicio: inicio, fechaFin: fin },
    });
  }

  it('una reserva real de 00:00 a 01:00 (calendario del día siguiente) choca con un fijo del día de SU jornada', async () => {
    await crearReservaMadrugada();
    expect(await ocupacionService.conflictoAlCrear(canchaId, { diaSemana: DIA }, 1440, 1500)).toBe(true);
  });

  it('esa misma reserva no choca con un fijo del día calendario siguiente', async () => {
    await crearReservaMadrugada();
    const diaCalendarioSiguiente = (DIA + 1) % 7;
    expect(await ocupacionService.conflictoAlCrear(canchaId, { diaSemana: diaCalendarioSiguiente }, 1440, 1500)).toBe(false);
  });

  it('una reserva de 20:00 a 21:00 sigue chocando con un fijo del mismo día', async () => {
    const p = getPrisma();
    const cli = await p.cliente.create({ data: { nombre: 'Luis', whatsapp: '+5491150000003' } });
    const inicio = new Date(`${FECHA}T20:00:00.000-03:00`);
    const fin = new Date(`${FECHA}T21:00:00.000-03:00`);
    const r = await p.reserva.create({
      data: { canchaId, clienteId: cli.id, estado: 'CONFIRMADA', esContacto: false, monto: 30000, fechaInicio: inicio, fechaFin: fin },
    });
    await p.reservaSector.create({
      data: { reservaId: r.id, sectorId, estado: 'CONFIRMADA', fechaInicio: inicio, fechaFin: fin },
    });
    expect(await ocupacionService.conflictoAlCrear(canchaId, { diaSemana: DIA }, 1200, 1260)).toBe(true);
  });

  it('el mismo caso por fecha: un bloqueo puntual de FECHA choca con la reserva de madrugada, no uno de la fecha calendario siguiente', async () => {
    await crearReservaMadrugada();
    expect(await ocupacionService.conflictoAlCrear(canchaId, { fecha: FECHA }, 1440, 1500)).toBe(true);
    expect(await ocupacionService.conflictoAlCrear(canchaId, { fecha: FECHA_SIG }, 1440, 1500)).toBe(false);
  });
});
