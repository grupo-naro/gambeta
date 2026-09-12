import { describe, it, expect } from 'vitest';
import { horasDeConfig } from '../../src/services/sheets/sheetsData.js';

describe('horasDeConfig', () => {
  it('una jornada que cierra a la 01:00 llega hasta las 00:00', () => {
    const horas = horasDeConfig('07:00', '01:00');
    expect(horas[0]).toBe('07:00');
    expect(horas[horas.length - 1]).toBe('00:00');
    expect(horas).toHaveLength(18); // 07:00..00:00
  });

  it('regresión: con cierre 23:00 no cambia', () => {
    const horas = horasDeConfig('16:00', '23:00');
    expect(horas).toEqual(['16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00']);
  });

  it('regresión: con cierre 00:00 tampoco', () => {
    const horas = horasDeConfig('16:00', '00:00');
    expect(horas[horas.length - 1]).toBe('23:00');
  });
});
