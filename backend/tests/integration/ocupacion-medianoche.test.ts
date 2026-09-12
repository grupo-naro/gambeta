import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { ocupacionService } from '../../src/services/ocupacion.service.js';

/**
 * "00:00" como hora de FIN vale 1440 (fin del día), no 0. La capa de ocupación lo convertía con
 * `fromHHMM`, que devuelve 0, y eso tiene dos consecuencias graves:
 *
 *  - un fijo o bloqueo que termina a medianoche ocupa el rango [1380, 0), que está vacío: no
 *    bloquea nada, aunque en el panel se vea creado.
 *  - una reserva que termina a medianoche queda invisible al crear un fijo o bloqueo, porque su
 *    minuto de fin también se lee como 0. El admin bloquea una cancha ya reservada sin aviso, y
 *    la exclusion constraint no lo frena: los fijos y bloqueos no son filas de ReservaSector.
 */
let canchaId: string; let sectorId: string;

beforeAll(setupTestDb);
afterAll(teardownTestDb);

// Fecha futura fija en día conocido: `conflictoAlCrear` sólo mira reservas futuras.
const EN_30_DIAS = new Date(Date.now() + 30 * 86400000);
const FECHA = EN_30_DIAS.toISOString().slice(0, 10);
const DIA_SEMANA = new Date(FECHA + 'T12:00:00.000Z').getUTCDay();

beforeEach(async () => {
  await resetTables();
  const p = getPrisma();
  const c = await p.cancha.create({ data: { nombre: 'C1', tipo: 'padel', precioHora: 30000 } });
  canchaId = c.id;
  const s = await p.sector.create({ data: { nombre: 'S1' } });
  sectorId = s.id;
  await p.canchaSector.create({ data: { canchaId, sectorId } });
});

describe('ocupación con horarios que terminan a medianoche', () => {
  it('un bloqueo de 23:00 a 00:00 ocupa hasta el minuto 1440, no hasta el 0', async () => {
    await getPrisma().bloqueo.create({
      data: { canchaId, motivo: 'MANTENIMIENTO', recurrente: true, diaSemana: DIA_SEMANA, horaInicio: '23:00', horaFin: '00:00', activo: true },
    });
    const rangos = await ocupacionService.rangosPlantilla(canchaId, FECHA);
    expect(rangos).toHaveLength(1);
    expect(rangos[0]).toMatchObject({ ini: 1380, fin: 1440, tipo: 'bloqueo' });
  });

  it('ese bloqueo efectivamente choca con un turno de 23:00 a 00:00', async () => {
    await getPrisma().bloqueo.create({
      data: { canchaId, motivo: 'MANTENIMIENTO', recurrente: true, diaSemana: DIA_SEMANA, horaInicio: '23:00', horaFin: '00:00', activo: true },
    });
    expect(await ocupacionService.conflictoReserva(canchaId, FECHA, 1380, 1440)).toBe('bloqueo');
  });

  it('un turno fijo de 23:00 a 00:00 también ocupa su rango', async () => {
    await getPrisma().turnoFijo.create({
      data: { canchaId, clienteNombre: 'Juan', diaSemana: DIA_SEMANA, horaInicio: '23:00', horaFin: '00:00', activo: true },
    });
    const rangos = await ocupacionService.rangosPlantilla(canchaId, FECHA);
    expect(rangos[0]).toMatchObject({ ini: 1380, fin: 1440, tipo: 'fijo' });
  });

  it('una reserva de 23:00 a 00:00 es visible al crear un bloqueo encima', async () => {
    const p = getPrisma();
    const cli = await p.cliente.create({ data: { nombre: 'Ana', whatsapp: '+5491150000001' } });
    const inicio = new Date(`${FECHA}T23:00:00.000-03:00`);
    const fin = new Date(`${FECHA}T23:00:00.000-03:00`);
    fin.setHours(fin.getHours() + 1); // 00:00 del día siguiente
    const r = await p.reserva.create({
      data: { canchaId, clienteId: cli.id, estado: 'CONFIRMADA', esContacto: false, monto: 30000, fechaInicio: inicio, fechaFin: fin },
    });
    await p.reservaSector.create({
      data: { reservaId: r.id, sectorId, estado: 'CONFIRMADA', fechaInicio: inicio, fechaFin: fin },
    });
    // Crear un bloqueo puntual de 23:00 a 00:00 sobre esa misma fecha tiene que detectar el choque.
    expect(await ocupacionService.conflictoAlCrear(canchaId, { fecha: FECHA }, 1380, 1440)).toBe(true);
  });

  it('no inventa conflictos donde no los hay', async () => {
    await getPrisma().bloqueo.create({
      data: { canchaId, motivo: 'MANTENIMIENTO', recurrente: true, diaSemana: DIA_SEMANA, horaInicio: '23:00', horaFin: '00:00', activo: true },
    });
    expect(await ocupacionService.conflictoReserva(canchaId, FECHA, 1080, 1140)).toBeNull();
  });
});
