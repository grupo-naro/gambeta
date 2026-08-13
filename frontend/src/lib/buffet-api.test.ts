import { describe, it, expect } from 'vitest';
import { cabecerasBuffet } from './buffet-api';

const KEY = 'clave-del-buffet';

describe('cabecerasBuffet', () => {
  it('siempre manda la llave del buffet', () => {
    expect(cabecerasBuffet(KEY, null)['x-buffet-key']).toBe(KEY);
  });

  it('con sesion, manda el token del mostrador', () => {
    expect(cabecerasBuffet(KEY, 'mostrador-principal.abc')['x-mostrador']).toBe('mostrador-principal.abc');
  });

  it('sin sesion NO manda x-mostrador', () => {
    // `/buffet/pin/verificar` se llama antes de que exista sesion y usa authBuffet, que no lo
    // pide. Mandar el header vacio haria que authMostrador lo rechace por token invalido.
    expect(cabecerasBuffet(KEY, null)).not.toHaveProperty('x-mostrador');
  });

  it('un token vacio cuenta como sin sesion', () => {
    expect(cabecerasBuffet(KEY, '')).not.toHaveProperty('x-mostrador');
  });

  it('respeta las cabeceras extra sin perder las propias', () => {
    const h = cabecerasBuffet(KEY, 'tok', { 'x-otra': '1' });
    expect(h['x-otra']).toBe('1');
    expect(h['x-buffet-key']).toBe(KEY);
    expect(h['x-mostrador']).toBe('tok');
  });
});
