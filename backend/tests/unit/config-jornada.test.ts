import { describe, it, expect } from 'vitest';
import { updateConfigSchema } from '../../src/validators/config.schema.js';

const base = { query: {}, params: {} };
const parsear = (body: Record<string, unknown>) => updateConfigSchema.safeParse({ ...base, body });

describe('cierre posterior a la medianoche', () => {
  it('acepta abrir 07:00 y cerrar 01:00', () => {
    expect(parsear({ horaApertura: '07:00', horaCierre: '01:00' }).success).toBe(true);
    expect(parsear({ horaAperturaFinde: '07:00', horaCierreFinde: '02:00' }).success).toBe(true);
  });

  it('sigue aceptando los cierres de hoy', () => {
    expect(parsear({ horaApertura: '07:00', horaCierre: '23:00' }).success).toBe(true);
    expect(parsear({ horaApertura: '07:00', horaCierre: '00:00' }).success).toBe(true);
  });

  it('rechaza una jornada de duración cero', () => {
    expect(parsear({ horaApertura: '07:00', horaCierre: '07:00' }).success).toBe(false);
  });

  it('acepta el pico corriendo hasta un cierre de madrugada', () => {
    expect(parsear({ horaApertura: '07:00', picoDesde: '20:00', picoHasta: '01:00' }).success).toBe(true);
  });
});
