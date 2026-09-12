import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { ocupacionService } from '../../src/services/ocupacion.service.js';

let canchaId: string;
beforeAll(setupTestDb);
afterAll(teardownTestDb);

const EN_30 = new Date(Date.now() + 30 * 86400000);
const FECHA = EN_30.toISOString().slice(0, 10);
const DIA = new Date(FECHA + 'T12:00:00.000Z').getUTCDay();

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
  await p.canchaSector.create({ data: { canchaId, sectorId: s.id } });
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
