import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { buffetEntregaService } from '../../src/services/buffetEntrega.service.js';
import { hashPassword } from '../../src/utils/password.js';

let app: any;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

let productoId: string;
beforeEach(async () => {
  await resetTables();
  productoId = (await getPrisma().productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 20 } })).id;
  // PINs para los tests que pasan por HTTP (login -> token -> x-mostrador), igual que en
  // buffet-identidad.test.ts.
  await getPrisma().mostrador.update({ where: { id: 'mostrador-principal' }, data: { pinHash: await hashPassword('1111') } });
  await getPrisma().mostrador.update({ where: { id: 'mostrador-secundario' }, data: { pinHash: await hashPassword('2222') } });
});

const key = (r: any) => r.set('x-buffet-key', process.env.BUFFET_API_KEY!);
const tokenDe = async (pin: string) => (await key(supertest(app).post('/buffet/pin/verificar')).send({ pin })).body.token as string;

const asignado = async () =>
  (await getPrisma().stockMostrador.findUnique({
    where: { mostradorId_productoId: { mostradorId: 'mostrador-secundario', productoId } },
  }))?.cantidad ?? 0;

const general = async () =>
  (await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id: productoId } })).stock;

describe('entrega del principal al secundario', () => {
  it('mueve el stock: baja el general y sube el asignado', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 12 }] });
    expect(await general()).toBe(8);
    expect(await asignado()).toBe(12);
  });

  it('no inventa unidades: dos entregas suman', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 5 }] });
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 3 }] });
    expect(await general()).toBe(12);
    expect(await asignado()).toBe(8);
    // El total sigue siendo 20: nada se creó ni se perdió.
    expect((await general()) + (await asignado())).toBe(20);
  });

  it('no se puede entregar más de lo que hay en el general', async () => {
    await expect(
      buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 21 }] }),
    ).rejects.toThrow();
    expect(await general()).toBe(20);
    expect(await asignado()).toBe(0);
  });

  it('queda registrado quién y qué', async () => {
    const { entregaId } = await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 4 }] });
    const e = await getPrisma().entregaMostrador.findUniqueOrThrow({ where: { id: entregaId }, include: { lineas: true } });
    expect(e.mostradorId).toBe('mostrador-secundario');
    expect(e.lineas).toHaveLength(1);
    expect(e.lineas[0].cantidad).toBe(4);
  });

  it('una entrega con varias líneas es todo o nada', async () => {
    const otro = await getPrisma().productoBuffet.create({ data: { nombre: 'Agua', precio: 1000, stock: 2 } });
    await expect(
      buffetEntregaService.entregar({
        desdeMostradorId: 'mostrador-principal',
        items: [{ productoId, cantidad: 5 }, { productoId: otro.id, cantidad: 99 }],
      }),
    ).rejects.toThrow();
    // La primera línea NO se aplicó: si se aplicara, quedaría stock movido por una entrega
    // que el operador vio fallar.
    expect(await general()).toBe(20);
    expect(await asignado()).toBe(0);
  });

  it('cantidad cero o negativa se rechaza', async () => {
    await expect(
      buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 0 }] }),
    ).rejects.toThrow();
  });

  it('el secundario no puede entregarse stock a sí mismo: solo el principal entrega', async () => {
    // Es la regla completa detrás de por qué la ruta usa authMostrador (QUIÉN entrega importa)
    // en vez de authBuffet. Si esta rama se rompe, el secundario podría autoabastecerse desde
    // el general sin pasar por el principal, y la conciliación de la Task 5 pierde sentido.
    await expect(
      buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-secundario', items: [{ productoId, cantidad: 1 }] }),
    ).rejects.toThrow();
    expect(await general()).toBe(20);
    expect(await asignado()).toBe(0);
  });
});

describe('stockAsignado', () => {
  it('devuelve lo que el secundario tiene asignado', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 6 }] });
    expect(await buffetEntregaService.stockAsignado('mostrador-secundario')).toEqual([{ productoId, cantidad: 6 }]);
  });

  it('el principal no tiene stock asignado: StockMostrador es solo del secundario', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 6 }] });
    expect(await buffetEntregaService.stockAsignado('mostrador-principal')).toEqual([]);
  });
});

describe('rutas HTTP: POST /buffet/entregas y GET /buffet/stock-asignado', () => {
  it('sin x-mostrador responde 401: la ruta exige el token, no solo la buffet key', async () => {
    const r = await key(supertest(app).post('/buffet/entregas')).send({ items: [{ productoId, cantidad: 1 }] });
    expect(r.status).toBe(401);
  });

  it('el secundario recibe 403 al intentar entregar', async () => {
    const tokenSecundario = await tokenDe('2222');
    const r = await key(supertest(app).post('/buffet/entregas')).set('x-mostrador', tokenSecundario).send({ items: [{ productoId, cantidad: 1 }] });
    expect(r.status).toBe(403);
  });

  it('body sin items lo rechaza el validador (400)', async () => {
    const tokenPrincipal = await tokenDe('1111');
    const r = await key(supertest(app).post('/buffet/entregas')).set('x-mostrador', tokenPrincipal).send({ items: [] });
    expect(r.status).toBe(400);
  });

  it('el principal entrega por HTTP y el secundario ve el stock asignado por GET /stock-asignado', async () => {
    const tokenPrincipal = await tokenDe('1111');
    const rEntrega = await key(supertest(app).post('/buffet/entregas')).set('x-mostrador', tokenPrincipal).send({ items: [{ productoId, cantidad: 7 }] });
    expect(rEntrega.status).toBe(200);
    expect(rEntrega.body.entregaId).toBeTruthy();
    expect(await general()).toBe(13);

    const tokenSecundario = await tokenDe('2222');
    const rStock = await key(supertest(app).get('/buffet/stock-asignado')).set('x-mostrador', tokenSecundario);
    expect(rStock.status).toBe(200);
    expect(rStock.body).toEqual([{ productoId, cantidad: 7 }]);
  });

  it('sin x-mostrador, GET /buffet/stock-asignado también responde 401', async () => {
    const r = await key(supertest(app).get('/buffet/stock-asignado'));
    expect(r.status).toBe(401);
  });
});
