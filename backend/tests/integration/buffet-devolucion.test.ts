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
  await getPrisma().mostrador.update({ where: { id: 'mostrador-principal' }, data: { pinHash: await hashPassword('1111') } });
  await getPrisma().mostrador.update({ where: { id: 'mostrador-secundario' }, data: { pinHash: await hashPassword('2222') } });
});

const key = (r: any) => r.set('x-buffet-key', process.env.BUFFET_API_KEY!);
const tokenDe = async (pin: string) => (await key(supertest(app).post('/buffet/pin/verificar')).send({ pin })).body.token as string;
const general = async () => (await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id: productoId } })).stock;
const asignado = async () =>
  (await getPrisma().stockMostrador.findUnique({ where: { mostradorId_productoId: { mostradorId: 'mostrador-secundario', productoId } } }))?.cantidad ?? 0;
const entregar = (cantidad: number) => buffetEntregaService.entregar({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad }] });

describe('devolución del secundario al principal', () => {
  it('baja el cupo del secundario y no toca el stock general (el total no cambia)', async () => {
    await entregar(5);
    await buffetEntregaService.devolver({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 5 }] });
    expect(await asignado()).toBe(0);
    expect(await general()).toBe(20);
  });

  it('devolución parcial: devuelve 2 de 5', async () => {
    await entregar(5);
    await buffetEntregaService.devolver({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 2 }] });
    expect(await asignado()).toBe(3);
  });

  it('lo devuelto vuelve a estar libre para asignar', async () => {
    await entregar(20);
    await expect(entregar(1)).rejects.toThrow();
    await buffetEntregaService.devolver({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 4 }] });
    await entregar(4);
    expect(await asignado()).toBe(20);
  });

  it('no se puede devolver más de lo que el secundario tiene', async () => {
    await entregar(5);
    await expect(
      buffetEntregaService.devolver({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 6 }] }),
    ).rejects.toThrow(/tiene 5/);
    expect(await asignado()).toBe(5);
  });

  it('un producto que el secundario no tiene no se puede devolver', async () => {
    await expect(
      buffetEntregaService.devolver({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 1 }] }),
    ).rejects.toThrow();
  });

  it('con varias líneas es todo o nada', async () => {
    const otro = await getPrisma().productoBuffet.create({ data: { nombre: 'Agua', precio: 1000, stock: 10 } });
    await entregar(5);
    await expect(
      buffetEntregaService.devolver({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 3 }, { productoId: otro.id, cantidad: 1 }] }),
    ).rejects.toThrow();
    expect(await asignado()).toBe(5);
  });

  it('solo el principal puede devolver', async () => {
    await entregar(5);
    await expect(
      buffetEntregaService.devolver({ desdeMostradorId: 'mostrador-secundario', items: [{ productoId, cantidad: 1 }] }),
    ).rejects.toThrow();
    expect(await asignado()).toBe(5);
  });

  it('queda registrada como un movimiento negativo, para el historial', async () => {
    await entregar(5);
    const { entregaId } = await buffetEntregaService.devolver({ desdeMostradorId: 'mostrador-principal', items: [{ productoId, cantidad: 2 }] });
    const e = await getPrisma().entregaMostrador.findUniqueOrThrow({ where: { id: entregaId }, include: { lineas: true } });
    expect(e.lineas[0].cantidad).toBe(-2);
  });

  it('por HTTP: el principal devuelve (200) y el secundario recibe 403', async () => {
    await entregar(5);
    const principal = await tokenDe('1111');
    const ok = await key(supertest(app).post('/buffet/devoluciones')).set('x-mostrador', principal).send({ items: [{ productoId, cantidad: 2 }] });
    expect(ok.status).toBe(200);
    expect(await asignado()).toBe(3);

    const secundario = await tokenDe('2222');
    const no = await key(supertest(app).post('/buffet/devoluciones')).set('x-mostrador', secundario).send({ items: [{ productoId, cantidad: 1 }] });
    expect(no.status).toBe(403);
  });
});
