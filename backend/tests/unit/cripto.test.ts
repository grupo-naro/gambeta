import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';

// La clave se lee de getEnv(), que cachea process.env en la primera llamada.
// Hay que setearla ANTES de importar el módulo.
beforeAll(() => { process.env.MP_ENCRYPTION_KEY = randomBytes(32).toString('base64'); });

describe('cripto', () => {
  it('lo cifrado se puede descifrar', async () => {
    const { cifrar, descifrar } = await import('../../src/utils/cripto.js');
    const secreto = 'APP_USR-1234567890-abcdef';
    expect(descifrar(cifrar(secreto))).toBe(secreto);
  });

  it('dos cifrados del mismo texto dan resultados distintos', async () => {
    const { cifrar } = await import('../../src/utils/cripto.js');
    // Cada cifrado usa un IV nuevo. Si dieran igual, un atacante con la base podría
    // saber que dos filas guardan el mismo token.
    expect(cifrar('mismo')).not.toBe(cifrar('mismo'));
  });

  it('el texto cifrado no contiene el original', async () => {
    const { cifrar } = await import('../../src/utils/cripto.js');
    expect(cifrar('APP_USR-secreto')).not.toContain('APP_USR');
  });

  it('un dato alterado se rechaza en vez de devolver basura', async () => {
    const { cifrar, descifrar } = await import('../../src/utils/cripto.js');
    const guardado = cifrar('APP_USR-secreto');
    const [iv, tag, datos] = guardado.split('.');
    // Se cambia el último carácter del contenido: GCM tiene que detectarlo.
    const alterado = `${iv}.${tag}.${datos.slice(0, -2)}${datos.slice(-2) === 'AA' ? 'AB' : 'AA'}`;
    expect(() => descifrar(alterado)).toThrow();
  });

  it('un formato inválido se rechaza', async () => {
    const { descifrar } = await import('../../src/utils/cripto.js');
    expect(() => descifrar('cualquier-cosa')).toThrow();
  });
});
