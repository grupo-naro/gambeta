import { describe, it, expect, beforeEach } from 'vitest';
import { firmarToken, tokenValido } from './buffet-session';

beforeEach(() => { process.env.BUFFET_API_KEY = 'clave-de-prueba-1234567890'; });

describe('token de sesion del mostrador', () => {
  it('un token recien firmado es valido', () => {
    expect(tokenValido(firmarToken(Date.now() + 60_000))).toBe(true);
  });

  it('un token vencido no es valido', () => {
    expect(tokenValido(firmarToken(Date.now() - 1))).toBe(false);
  });

  it('un token con la firma alterada no es valido', () => {
    const t = firmarToken(Date.now() + 60_000);
    const [exp] = t.split('.');
    expect(tokenValido(`${exp}.firmafalsa`)).toBe(false);
  });

  it('cambiar el exp sin refirmar invalida el token', () => {
    const t = firmarToken(Date.now() + 1000);
    const [, sig] = t.split('.');
    expect(tokenValido(`${Date.now() + 999_999}.${sig}`)).toBe(false);
  });

  it('basura no rompe, devuelve false', () => {
    expect(tokenValido('')).toBe(false);
    expect(tokenValido('sin-punto')).toBe(false);
  });
});
