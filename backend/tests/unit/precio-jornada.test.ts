import { describe, it, expect, beforeAll } from 'vitest';
import { precioDeRango } from '../../src/services/precio.service.js';

beforeAll(() => { process.env.TZ_NEGOCIO ||= 'America/Argentina/Buenos_Aires'; });

const cancha = { precioHora: 30000, precioHoraPico: 40000 };
// 2026-09-11 es viernes (día de semana).
const VIERNES = '2026-09-11';

// Complejo 07:00 a 01:00, pico de 20:00 hasta el cierre.
const cfg = {
  horaApertura: '07:00', horaAperturaFinde: '07:00',
  picoDesde: '20:00', picoHasta: '01:00',
  picoFindeDesde: '20:00', picoFindeHasta: '01:00',
};

describe('precio con jornada que cruza medianoche', () => {
  it('el turno de las 00:00 se cobra a precio PICO, no base', () => {
    expect(precioDeRango(cancha, VIERNES, '00:00', 60, cfg)).toBe(40000);
  });

  it('un turno de 21:00 dentro del pico también', () => {
    expect(precioDeRango(cancha, VIERNES, '21:00', 60, cfg)).toBe(40000);
  });

  it('un turno de la mañana sigue a precio base', () => {
    expect(precioDeRango(cancha, VIERNES, '10:00', 60, cfg)).toBe(30000);
  });

  it('un turno de 90 minutos que arranca 23:30 cruza la medianoche', () => {
    // 23:30 a 01:00: los 90 minutos caen enteros dentro del pico (20:00 a 01:00).
    expect(precioDeRango(cancha, VIERNES, '23:30', 90, cfg)).toBe(60000);
  });

  it('un turno que arranca antes del pico se cobra entero a tarifa base', () => {
    // 19:00 a 21:00 arranca en base (pico desde 20:00): 2 h de base, no 1 base + 1 pico (antes 70.000).
    expect(precioDeRango(cancha, VIERNES, '19:00', 120, cfg)).toBe(60000);
  });
});

describe('regresión: las configuraciones de hoy dan el mismo precio', () => {
  const cfgHoy = {
    horaApertura: '16:00', horaAperturaFinde: '16:00',
    picoDesde: '18:00', picoHasta: '00:00',
    picoFindeDesde: '18:00', picoFindeHasta: '00:00',
  };

  it('pico que termina a medianoche, sin cruzarla', () => {
    expect(precioDeRango(cancha, VIERNES, '19:00', 60, cfgHoy)).toBe(40000);
    expect(precioDeRango(cancha, VIERNES, '23:00', 60, cfgHoy)).toBe(40000);
    expect(precioDeRango(cancha, VIERNES, '17:00', 60, cfgHoy)).toBe(30000);
  });

  it('17:00 a 19:00 arranca en base: dos horas a tarifa base', () => {
    expect(precioDeRango(cancha, VIERNES, '17:00', 120, cfgHoy)).toBe(60000);
  });

  it('sin franja pico cargada, todo es precio base', () => {
    const sinPico = { horaApertura: '16:00', horaAperturaFinde: '16:00', picoDesde: '', picoHasta: '', picoFindeDesde: '', picoFindeHasta: '' };
    expect(precioDeRango(cancha, VIERNES, '21:00', 60, sinPico)).toBe(30000);
  });
});
