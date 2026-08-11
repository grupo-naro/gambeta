import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { hashPassword } from '../../src/utils/password.js';

let app: any;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  await getPrisma().mostrador.update({ where: { id: 'mostrador-principal' }, data: { pinHash: await hashPassword('1111') } });
  await getPrisma().mostrador.update({ where: { id: 'mostrador-secundario' }, data: { pinHash: await hashPassword('2222') } });
});

const key = (r: any) => r.set('x-buffet-key', process.env.BUFFET_API_KEY!);

describe('el PIN identifica al mostrador', () => {
  it('el PIN del principal devuelve al principal y un token', async () => {
    const res = await key(supertest(app).post('/buffet/pin/verificar')).send({ pin: '1111' });
    expect(res.status).toBe(200);
    expect(res.body.tipo).toBe('PRINCIPAL');
    expect(res.body.token).toBeTruthy();
  });

  it('el PIN del secundario devuelve al secundario', async () => {
    const res = await key(supertest(app).post('/buffet/pin/verificar')).send({ pin: '2222' });
    expect(res.status).toBe(200);
    expect(res.body.tipo).toBe('SECUNDARIO');
  });

  it('un PIN que no es de nadie no entra', async () => {
    const res = await key(supertest(app).post('/buffet/pin/verificar')).send({ pin: '9999' });
    expect(res.status).toBe(401);
  });

  it('el token no lleva el PIN ni el hash', async () => {
    const res = await key(supertest(app).post('/buffet/pin/verificar')).send({ pin: '1111' });
    expect(res.body.token).not.toContain('1111');
    expect(res.body.token).not.toContain('$');
  });

  it('un token adulterado se rechaza: no se puede decir que sos otro mostrador', async () => {
    // Es el punto entero de firmar el token. Si esto pasara, el secundario podría cargar
    // su propio conteo de cierre haciéndose pasar por el principal.
    const { firmarTokenMostrador, verificarTokenMostrador } = await import('../../src/utils/mostradorToken.js');
    const token = firmarTokenMostrador('mostrador-secundario');
    expect(verificarTokenMostrador(token)).toBe('mostrador-secundario');
    const falso = token.replace('mostrador-secundario', 'mostrador-principal');
    expect(verificarTokenMostrador(falso)).toBeNull();
    expect(verificarTokenMostrador('cualquier-cosa')).toBeNull();
    expect(verificarTokenMostrador(undefined)).toBeNull();
  });

  it('sin token, una ruta del mostrador responde 401', async () => {
    const res = await key(supertest(app).get('/buffet/caja/actual'));
    expect(res.status).toBe(401);
  });

  it('un token adulterado no abre una ruta real: no alcanza con pasar el primer chequeo', async () => {
    // A diferencia del test de arriba (que llama a verificarTokenMostrador directo), este manda
    // el token falsificado por HTTP a una ruta real. Es la prueba de que la suplantación no
    // funciona en el camino que de verdad importa, no solo en la función que la implementa.
    const { firmarTokenMostrador } = await import('../../src/utils/mostradorToken.js');
    const tokenSecundario = firmarTokenMostrador('mostrador-secundario');
    const falso = tokenSecundario.replace('mostrador-secundario', 'mostrador-principal');
    const res = await key(supertest(app).get('/buffet/caja/actual')).set('x-mostrador', falso);
    expect(res.status).toBe(401);
  });

  it('con token válido, la ruta responde', async () => {
    const login = await key(supertest(app).post('/buffet/pin/verificar')).send({ pin: '1111' });
    const res = await key(supertest(app).get('/buffet/caja/actual')).set('x-mostrador', login.body.token);
    expect(res.status).toBe(200);
  });
});
