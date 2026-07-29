import { describe, it, expect, beforeAll } from 'vitest';
import { precioEfectivo } from '../../src/services/precio.service.js';

beforeAll(() => { process.env.TZ_NEGOCIO ||= 'America/Argentina/Buenos_Aires'; });

const cfg = { picoDesde: '19:00', picoHasta: '23:00', picoFindeDesde: '14:00', picoFindeHasta: '23:00' };
const cancha = { precioHora: 10000, precioHoraPico: 15000 };
// 2026-06-10 = miércoles (semana); 2026-06-13 = sábado (finde)

describe('precioEfectivo', () => {
  it('sin pico configurado en la cancha (precioHoraPico=0) → precio base', () => {
    expect(precioEfectivo({ precioHora: 10000, precioHoraPico: 0 }, '2026-06-10', '20:00', cfg)).toBe(10000);
  });
  it('hora dentro de la franja de semana → pico', () => {
    expect(precioEfectivo(cancha, '2026-06-10', '20:00', cfg)).toBe(15000);
  });
  it('hora fuera de la franja de semana → base', () => {
    expect(precioEfectivo(cancha, '2026-06-10', '18:00', cfg)).toBe(10000);
  });
  it('borde: inicio de franja incluido, fin excluido', () => {
    expect(precioEfectivo(cancha, '2026-06-10', '19:00', cfg)).toBe(15000); // desde inclusive
    expect(precioEfectivo(cancha, '2026-06-10', '23:00', cfg)).toBe(10000); // hasta exclusivo
  });
  it('finde usa la franja de finde (14:00 está en pico el sábado pero no en semana)', () => {
    expect(precioEfectivo(cancha, '2026-06-13', '14:00', cfg)).toBe(15000); // sábado, franja finde
    expect(precioEfectivo(cancha, '2026-06-10', '14:00', cfg)).toBe(10000); // miércoles, fuera de franja semana
  });
  it('franja vacía → base', () => {
    const sinFranja = { picoDesde: '', picoHasta: '', picoFindeDesde: '', picoFindeHasta: '' };
    expect(precioEfectivo(cancha, '2026-06-10', '20:00', sinFranja)).toBe(10000);
  });
});
