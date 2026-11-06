import { describe, it, expect } from 'vitest';
import { pinValido, errorDePinNuevo } from './pin-dashboard';

describe('pinValido', () => {
  it('acepta de 4 a 8 números', () => {
    expect(pinValido('1234')).toBe(true);
    expect(pinValido('12345678')).toBe(true);
  });
  it('rechaza lo corto, lo largo y lo que no son números', () => {
    expect(pinValido('123')).toBe(false);
    expect(pinValido('123456789')).toBe(false);
    expect(pinValido('12a4')).toBe(false);
    expect(pinValido('')).toBe(false);
  });
});

describe('errorDePinNuevo', () => {
  it('sin error cuando es válido y coincide', () => expect(errorDePinNuevo('1234', '1234')).toBeNull());
  it('avisa si no coinciden', () => expect(errorDePinNuevo('1234', '1235')).toMatch(/no coinciden/));
  it('avisa si el formato no sirve', () => expect(errorDePinNuevo('12', '12')).toMatch(/4 a 8/));
});
