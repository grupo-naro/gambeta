import { describe, it, expect } from 'vitest';
import { calcularTotalAlquiler, puedeEntregar } from './pantalla-alquileres';

describe('calcularTotalAlquiler', () => {
  it('multiplica precio por cantidad', () => { expect(calcularTotalAlquiler(3000, 2)).toBe(6000); });
  it('trata vacío/NaN como 0', () => { expect(calcularTotalAlquiler(3000, NaN)).toBe(0); });
  it('nunca es negativo', () => { expect(calcularTotalAlquiler(3000, -1)).toBe(0); });
});

describe('puedeEntregar', () => {
  it('deja entregar hasta el disponible', () => {
    expect(puedeEntregar({ disponible: 2 }, 2)).toBe(true);
  });
  it('no deja pasarse del disponible', () => {
    expect(puedeEntregar({ disponible: 2 }, 3)).toBe(false);
  });
  it('no deja entregar cero', () => {
    expect(puedeEntregar({ disponible: 5 }, 0)).toBe(false);
  });
});
