import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { buffetEntregaService } from '../../src/services/buffetEntrega.service.js';
import { buffetCajaService } from '../../src/services/buffetCaja.service.js';
import { buffetSecundarioService } from '../../src/services/buffetSecundario.service.js';
import { alquilerService } from '../../src/services/alquiler.service.js';
import { hashPassword } from '../../src/utils/password.js';

let app: any;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

const PRI = 'mostrador-principal';
const SEC = 'mostrador-secundario';
const TER = 'mostrador-tercero';

let productoId: string;
beforeEach(async () => {
  await resetTables();
  productoId = (await getPrisma().productoBuffet.create({ data: { nombre: 'Coca', precio: 2000, stock: 50 } })).id;
});

const cupo = async (mostradorId: string) =>
  (await getPrisma().stockMostrador.findUnique({ where: { mostradorId_productoId: { mostradorId, productoId } } }))?.cantidad ?? 0;
const general = async () => (await getPrisma().productoBuffet.findUniqueOrThrow({ where: { id: productoId } })).stock;
const vender = (mostradorId: string, cantidad: number, uid: string) =>
  buffetCajaService.cobrar({ mostradorId, uid, medioPago: 'EFECTIVO', montoPagado: 999999, items: [{ productoId, cantidad }] });
const key = (r: any) => r.set('x-buffet-key', process.env.BUFFET_API_KEY!);

describe('el mostrador tercero existe', () => {
  it('la base lo trae con su PIN vacío y como puesto con cupo', async () => {
    const t = await getPrisma().mostrador.findUniqueOrThrow({ where: { id: TER } });
    expect(t).toMatchObject({ tipo: 'TERCERO', activo: true, pinHash: '' });
  });

  it('su PIN lo identifica como tercero', async () => {
    await getPrisma().mostrador.update({ where: { id: TER }, data: { pinHash: await hashPassword('3333') } });
    const r = await key(supertest(app).post('/buffet/pin/verificar')).send({ pin: '3333' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ tipo: 'TERCERO', nombre: 'Tercero' });
  });

  it('no se puede repetir el PIN de otro mostrador', async () => {
    await getPrisma().mostrador.update({ where: { id: SEC }, data: { pinHash: await hashPassword('2222') } });
    const { buffetPinService } = await import('../../src/services/buffetPin.service.js');
    await expect(buffetPinService.setear(TER, '2222')).rejects.toThrow(/ya está en uso/);
  });
});

describe('entregas al tercero', () => {
  it('le asigna cupo sin tocar el del secundario ni el stock general', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: TER, items: [{ productoId, cantidad: 10 }] });
    expect(await cupo(TER)).toBe(10);
    expect(await cupo(SEC)).toBe(0);
    expect(await general()).toBe(50);
  });

  it('sin puestoId sigue entregando al secundario (compatibilidad)', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: PRI, items: [{ productoId, cantidad: 4 }] });
    expect(await cupo(SEC)).toBe(4);
    expect(await cupo(TER)).toBe(0);
  });

  it('lo libre descuenta lo asignado a los dos puestos', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: SEC, items: [{ productoId, cantidad: 30 }] });
    await buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: TER, items: [{ productoId, cantidad: 15 }] });
    await expect(buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: TER, items: [{ productoId, cantidad: 6 }] }))
      .rejects.toThrow(/5 sin asignar/);
  });

  it('el principal no es un destino válido', async () => {
    await expect(buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: PRI, items: [{ productoId, cantidad: 1 }] }))
      .rejects.toThrow(/principal/i);
  });

  it('un puesto que no existe se rechaza', async () => {
    await expect(buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: 'mostrador-cuarto', items: [{ productoId, cantidad: 1 }] }))
      .rejects.toThrow();
  });

  it('solo el principal entrega', async () => {
    await expect(buffetEntregaService.entregar({ desdeMostradorId: TER, puestoId: TER, items: [{ productoId, cantidad: 1 }] }))
      .rejects.toThrow(/principal/i);
  });

  it('devolver le baja el cupo al tercero y no al secundario', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: SEC, items: [{ productoId, cantidad: 5 }] });
    await buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: TER, items: [{ productoId, cantidad: 8 }] });
    await buffetEntregaService.devolver({ desdeMostradorId: PRI, puestoId: TER, items: [{ productoId, cantidad: 3 }] });
    expect(await cupo(TER)).toBe(5);
    expect(await cupo(SEC)).toBe(5);
  });

  it('no se puede devolver más de lo que tiene el tercero', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: SEC, items: [{ productoId, cantidad: 9 }] });
    await expect(buffetEntregaService.devolver({ desdeMostradorId: PRI, puestoId: TER, items: [{ productoId, cantidad: 1 }] }))
      .rejects.toThrow(/no tiene tantas unidades/);
  });

  it('por HTTP: el principal entrega al tercero con puestoId y se ve su stock asignado', async () => {
    await getPrisma().mostrador.update({ where: { id: PRI }, data: { pinHash: await hashPassword('1111') } });
    const token = (await key(supertest(app).post('/buffet/pin/verificar')).send({ pin: '1111' })).body.token as string;
    const r = await key(supertest(app).post('/buffet/entregas')).set('x-mostrador', token).send({ puestoId: TER, items: [{ productoId, cantidad: 7 }] });
    expect(r.status).toBe(200);
    const s = await key(supertest(app).get(`/buffet/stock-asignado?mostradorId=${TER}`)).set('x-mostrador', token);
    expect(s.body).toEqual([{ productoId, cantidad: 7 }]);
  });
});

describe('ventas del tercero', () => {
  it('vende contra su cupo: baja el cupo y el total', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: TER, items: [{ productoId, cantidad: 10 }] });
    await buffetCajaService.abrir(TER);
    await vender(TER, 4, 'u1');
    expect(await cupo(TER)).toBe(6);
    expect(await general()).toBe(46);
  });

  it('sin cupo asignado no puede vender, aunque haya stock general', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: SEC, items: [{ productoId, cantidad: 10 }] });
    await buffetCajaService.abrir(TER);
    await expect(vender(TER, 1, 'u2')).rejects.toThrow(/No tenés stock asignado/);
  });

  it('su caja es independiente: puede estar abierta a la vez que la del secundario', async () => {
    await buffetCajaService.abrir(SEC);
    await expect(buffetCajaService.abrir(TER)).resolves.toBeTruthy();
  });

  it('no maneja alquileres (igual que el secundario)', async () => {
    await buffetCajaService.abrir(TER);
    const art = await getPrisma().articuloAlquiler.create({ data: { nombre: 'Pelota', precio: 1000, stock: 5 } });
    await expect(alquilerService.entregar({
      uid: 'a1', mostradorId: TER, articuloId: art.id, cantidad: 1, quienRetira: 'Juan', medioPago: 'EFECTIVO', montoPagado: 1000,
    } as any)).rejects.toThrow(/mostrador principal/);
  });
});

describe('resumen diario por puesto', () => {
  it('el del tercero no mezcla lo del secundario', async () => {
    await buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: SEC, items: [{ productoId, cantidad: 20 }] });
    await buffetEntregaService.entregar({ desdeMostradorId: PRI, puestoId: TER, items: [{ productoId, cantidad: 10 }] });
    await buffetCajaService.abrir(TER);
    await vender(TER, 3, 'u3');
    const [hoy] = await buffetSecundarioService.resumenDiario({ dias: 3, desde: '2000-01-01', mostradorId: TER });
    expect(hoy.totales).toMatchObject({ entregado: 10, vendido: 3, quedo: 7 });
    const [hoySec] = await buffetSecundarioService.resumenDiario({ dias: 3, desde: '2000-01-01' });
    expect(hoySec.totales).toMatchObject({ entregado: 20, vendido: 0, quedo: 20 });
  });
});
