import { describe, it, expect } from 'vitest';
import { parseCuota } from './monto';

describe('parseCuota', () => {
  it('campo vacío es válido y significa "sin cobro"', () => {
    expect(parseCuota('')).toEqual({ ok: true, monto: null });
    expect(parseCuota('   ')).toEqual({ ok: true, monto: null });
  });

  it('un monto normal se parsea', () => {
    expect(parseCuota('20000')).toEqual({ ok: true, monto: 20000 });
  });

  it('cero es válido (no genera cobro, pero no es un error de tipeo)', () => {
    expect(parseCuota('0')).toEqual({ ok: true, monto: 0 });
  });

  it('un texto no numérico se rechaza en vez de caer en NaN', () => {
    expect(parseCuota('abc').ok).toBe(false);
    expect(parseCuota('20,000').ok).toBe(false);
  });

  it('un monto negativo se rechaza', () => {
    expect(parseCuota('-5000').ok).toBe(false);
  });
});
