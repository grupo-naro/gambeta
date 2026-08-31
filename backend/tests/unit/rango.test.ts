import { describe, it, expect } from 'vitest';
import { rangoDeFechas } from '../../src/utils/rango.js';
import { AppError } from '../../src/utils/errors.js';

describe('rangoDeFechas', () => {
  it('sin parametros abarca los ultimos 90 dias', () => {
    const { start, end } = rangoDeFechas();
    const dias = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(dias)).toBe(90);
    expect(end.getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('con desde y hasta cubre el dia entero de `hasta`', () => {
    // El cierre de las 23:00 del dia `hasta` tiene que entrar: si el rango terminara a las
    // 00:00 de ese dia, el ultimo turno quedaria afuera y el reporte mentiria.
    const { start, end } = rangoDeFechas('2026-08-01', '2026-08-10');
    const dias = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(Math.round(dias)).toBe(10);
  });

  it('solo `desde` llega hasta ahora', () => {
    const { end } = rangoDeFechas('2026-08-01');
    expect(end.getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('`desde` posterior a `hasta` se rechaza con un error de negocio (no un Error crudo)', () => {
    // `toThrow()` a secas pasa con cualquier excepción, incluido un `throw new Error(...)` crudo
    // que violaría la regla del proyecto y haría que el endpoint devuelva 500 en vez de 400.
    // Por eso se afirma sobre `status`/`code` de `AppError`, no solo sobre que algo se lanzó.
    let error: unknown;
    try {
      rangoDeFechas('2026-08-10', '2026-08-01');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).status).toBe(400);
    expect((error as AppError).code).toBe('BAD_REQUEST');
  });
});
