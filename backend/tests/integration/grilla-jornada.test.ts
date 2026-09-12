import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { disponibilidadService } from '../../src/services/disponibilidad.service.js';

let canchaId: string;
beforeAll(setupTestDb);
afterAll(teardownTestDb);

const FECHA = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

async function configurar(horaCierre: string) {
  await getPrisma().configuracion.upsert({
    where: { id: 'default' },
    create: { id: 'default', horaApertura: '07:00', horaCierre, horaAperturaFinde: '07:00', horaCierreFinde: horaCierre },
    update: { horaApertura: '07:00', horaCierre, horaAperturaFinde: '07:00', horaCierreFinde: horaCierre },
  });
}

beforeEach(async () => {
  await resetTables();
  const p = getPrisma();
  const c = await p.cancha.create({ data: { nombre: 'C1', tipo: 'padel', precioHora: 30000 } });
  canchaId = c.id;
  const s = await p.sector.create({ data: { nombre: 'S1' } });
  await p.canchaSector.create({ data: { canchaId, sectorId: s.id } });
});

describe('grilla con jornada que cierra a la 01:00', () => {
  it('publica el turno de las 00:00', async () => {
    await configurar('01:00');
    const { slots } = await disponibilidadService.listar(canchaId, FECHA);
    const horas = slots.map((s) => s.horaInicio);
    expect(horas).toContain('23:00');
    expect(horas).toContain('00:00');
    expect(horas).not.toContain('24:00'); // la etiqueta es de reloj, no de minutos
  });

  it('el turno de las 00:00 apunta al instante del día siguiente', async () => {
    await configurar('01:00');
    const { slots } = await disponibilidadService.listar(canchaId, FECHA);
    const medianoche = slots.find((s) => s.horaInicio === '00:00')!;
    const esperado = new Date(`${FECHA}T00:00:00.000-03:00`);
    esperado.setDate(esperado.getDate() + 1);
    expect(new Date(medianoche.inicioUtc).toISOString()).toBe(esperado.toISOString());
  });

  it('no publica nada después del cierre', async () => {
    await configurar('01:00');
    const { slots } = await disponibilidadService.listar(canchaId, FECHA);
    expect(slots.map((s) => s.horaInicio)).not.toContain('01:00');
  });
});

describe('regresión: las configuraciones de hoy publican lo mismo', () => {
  it('con cierre 23:00 el último turno de pádel es 22:00', async () => {
    await configurar('23:00');
    const { slots } = await disponibilidadService.listar(canchaId, FECHA);
    const horas = slots.map((s) => s.horaInicio);
    expect(horas[horas.length - 1]).toBe('22:00');
    expect(horas).not.toContain('23:00');
  });

  it('con cierre 00:00 el último turno de pádel es 23:00', async () => {
    await configurar('00:00');
    const { slots } = await disponibilidadService.listar(canchaId, FECHA);
    const horas = slots.map((s) => s.horaInicio);
    expect(horas[horas.length - 1]).toBe('23:00');
    expect(horas).not.toContain('00:00');
  });
});
