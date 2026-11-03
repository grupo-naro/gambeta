import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

const fecha = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

async function escenario() {
  const { configService } = await import('../../src/services/config.service.js');
  await configService.get();
  await configService.update({ horaApertura: '08:00', horaCierre: '23:00', horaAperturaFinde: '08:00', horaCierreFinde: '23:00', picoDesde: '18:00', picoHasta: '23:00', picoFindeDesde: '18:00', picoFindeHasta: '23:00' });
  const cancha = await getPrisma().cancha.create({ data: { nombre: 'Pádel 1', tipo: 'padel', precioHora: 30000, precioHoraPico: 36000 } });
  const { disponibilidadService } = await import('../../src/services/disponibilidad.service.js');
  return { cancha, disponibilidadService };
}

describe('disponibilidad con duraciones', () => {
  it('los turnos arrancan cada 30 minutos', async () => {
    const { cancha, disponibilidadService } = await escenario();
    const { slots } = await disponibilidadService.listar(cancha.id, fecha);
    const horas = slots.map((s) => s.horaInicio);
    expect(horas).toContain('08:00');
    expect(horas).toContain('08:30');
  });

  it('cada slot informa sus duraciones viables con el precio prorrateado', async () => {
    const { cancha, disponibilidadService } = await escenario();
    const { slots } = await disponibilidadService.listar(cancha.id, fecha);
    const s17 = slots.find((s) => s.horaInicio === '17:00')!;
    expect(s17.duraciones).toEqual([
      { min: 60, horaFin: '18:00', precio: 30000 },
      { min: 90, horaFin: '18:30', precio: 45000 },
      { min: 120, horaFin: '19:00', precio: 60000 },
    ]);
  });

  it('cerca del cierre solo quedan las duraciones que entran', async () => {
    const { cancha, disponibilidadService } = await escenario();
    const { slots } = await disponibilidadService.listar(cancha.id, fecha);
    const s2200 = slots.find((s) => s.horaInicio === '22:00')!;
    expect(s2200.duraciones.map((d) => d.min)).toEqual([60]); // 90 y 120 pasarían las 23:00
    expect(slots.find((s) => s.horaInicio === '22:30')).toBeUndefined(); // ni una hora entra
  });

  it('una reserva existente recorta las duraciones de los slots anteriores', async () => {
    const { cancha, disponibilidadService } = await escenario();
    const { reservaService } = await import('../../src/services/reserva.service.js');
    await reservaService.crear({ canchaId: cancha.id, fecha, horaInicio: '19:00', whatsapp: '5491133334444', nombreCliente: 'X', esContacto: true } as any);
    const { slots } = await disponibilidadService.listar(cancha.id, fecha);
    const s18 = slots.find((s) => s.horaInicio === '18:00')!;
    expect(s18.duraciones.map((d) => d.min)).toEqual([60]); // 90 y 120 pisarían la reserva de las 19:00
    expect(slots.find((s) => s.horaInicio === '19:00')).toBeUndefined();
  });
});

describe('grilla: contrato aditivo', () => {
  it('mantiene los campos viejos y agrega duraciones', async () => {
    const { cancha, disponibilidadService } = await escenario();
    const g = await disponibilidadService.grilla('padel', fecha);

    // Contrato viejo intacto: la web pública lo sigue consumiendo tal cual.
    expect(Array.isArray(g.horas)).toBe(true);
    expect(g.libres[cancha.id]['17:00']).toBe(true);
    expect(g.precios[cancha.id]['17:00']).toBe(30000); // sigue siendo el precio de 60 minutos

    // Campo nuevo.
    expect(g.duraciones[cancha.id]['17:00']).toEqual([
      { min: 60, horaFin: '18:00', precio: 30000 },
      { min: 90, horaFin: '18:30', precio: 45000 },
      { min: 120, horaFin: '19:00', precio: 60000 },
    ]);
  });
});
