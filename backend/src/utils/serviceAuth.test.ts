import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isValidServiceKey } from './serviceAuth.js';

const ORIG = { k: process.env.SERVICE_API_KEY, ks: process.env.SERVICE_API_KEYS };
beforeEach(() => { process.env.SERVICE_API_KEY = 'primaria'; process.env.SERVICE_API_KEYS = 'segunda, tercera'; });
afterEach(() => { process.env.SERVICE_API_KEY = ORIG.k; process.env.SERVICE_API_KEYS = ORIG.ks; });

describe('isValidServiceKey', () => {
  it('acepta la key primaria', () => { expect(isValidServiceKey('primaria')).toBe(true); });
  it('acepta una key de SERVICE_API_KEYS (con espacios alrededor)', () => {
    expect(isValidServiceKey('segunda')).toBe(true);
    expect(isValidServiceKey('tercera')).toBe(true);
  });
  it('rechaza una key que no está en el set', () => { expect(isValidServiceKey('otra')).toBe(false); });
  it('rechaza vacío / undefined / null', () => {
    expect(isValidServiceKey('')).toBe(false);
    expect(isValidServiceKey(undefined)).toBe(false);
    expect(isValidServiceKey(null)).toBe(false);
  });
  it('no lanza cuando los largos difieren', () => {
    expect(() => isValidServiceKey('x')).not.toThrow();
    expect(isValidServiceKey('x')).toBe(false);
  });
  it('si SERVICE_API_KEYS está vacía, solo vale la primaria', () => {
    process.env.SERVICE_API_KEYS = '';
    expect(isValidServiceKey('primaria')).toBe(true);
    expect(isValidServiceKey('segunda')).toBe(false);
  });
});
