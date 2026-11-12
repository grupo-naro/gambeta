import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { canchaService } from '../../src/services/cancha.service.js';
import { buffetCuentaService } from '../../src/services/buffetCuenta.service.js';
import { hashPassword } from '../../src/utils/password.js';

const KEY = 'buffet-key-de-prueba-1234567890';
const PRI = 'mostrador-principal';
const SEC = 'mostrador-secundario';
const TER = 'mostrador-tercero';

let app: any;
const tokens: Record<string, string> = {};
let padel: { id: string };
let futbol5: { id: string }; let futbol7: { id: string };
// Dos canchas de 9, cada una dividida en tres de 6.
let c1: { entera: any; partes: any[] };
let c2: { entera: any; partes: any[] };

beforeAll(async () => {
  process.env.BUFFET_API_KEY = KEY;
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

async function divisible(nombre: string) {
  const filas = await canchaService.crearDivisible({ nombre, partes: 3, precioEntera: 150000, precioParte: 50000, jugadoresEntera: 9, jugadoresParte: 6 });
  return { entera: filas.find((c) => c.esEntera)!, partes: filas.filter((c) => !c.esEntera).sort((a, b) => a.nombre.localeCompare(b.nombre)) };
}

beforeEach(async () => {
  await resetTables();
  const p = getPrisma();
  for (const [id, pin] of [[PRI, '1111'], [SEC, '2222'], [TER, '3333']] as const) {
    await p.mostrador.update({ where: { id }, data: { pinHash: await hashPassword(pin) } });
    tokens[id] = (await supertest(app).post('/buffet/pin/verificar').set('x-buffet-key', KEY).send({ pin })).body.token;
  }
  padel = await p.cancha.create({ data: { nombre: 'Pádel 1', tipo: 'padel', precioHora: 30000 } });
  futbol5 = await p.cancha.create({ data: { nombre: 'Fútbol 5 · Cancha 1', tipo: 'futbol5', jugadores: 5, precioHora: 30000 } });
  futbol7 = await p.cancha.create({ data: { nombre: 'Fútbol 7 · Cancha 4', tipo: 'futbol7', jugadores: 7, precioHora: 40000 } });
  c1 = await divisible('CANCHA 1');
  c2 = await divisible('CANCHA 2');
});

const listar = (mostradorId: string) =>
  supertest(app).get('/buffet/canchas').set('x-buffet-key', KEY).set('x-mostrador', tokens[mostradorId]);

/** Una reserva en curso (empezó hace media hora, termina en media hora) ocupando los sectores de esa cancha. */
async function reservaEnCurso(canchaId: string) {
  const p = getPrisma();
  const cli = await p.cliente.create({ data: { nombre: 'Facundo', whatsapp: '+5491100000000' } });
  const ini = new Date(Date.now() - 30 * 60000); const fin = new Date(Date.now() + 30 * 60000);
  const r = await p.reserva.create({ data: { canchaId, clienteId: cli.id, estado: 'CONFIRMADA', esContacto: true, monto: 50000, fechaInicio: ini, fechaFin: fin } });
  const sectores = await p.canchaSector.findMany({ where: { canchaId } });
  for (const s of sectores) await p.reservaSector.create({ data: { reservaId: r.id, sectorId: s.sectorId, estado: 'CONFIRMADA', fechaInicio: ini, fechaFin: fin } });
  return r;
}

describe('qué canchas ve cada mostrador', () => {
  it('el principal ve solo el pádel, como siempre', async () => {
    const r = await listar(PRI);
    expect(r.status).toBe(200);
    expect(r.body.map((c: any) => c.id)).toEqual([padel.id]);
  });

  it('el secundario ve las 8 canchas de fútbol de 6 y de 9, sin pádel ni otros tamaños (5, 7)', async () => {
    const r = await listar(SEC);
    const ids = r.body.map((c: any) => c.id);
    expect(ids).toHaveLength(8);
    expect(ids).toEqual(expect.arrayContaining([c1.entera.id, c2.entera.id, ...c1.partes.map((c: any) => c.id), ...c2.partes.map((c: any) => c.id)]));
    expect(ids).not.toContain(padel.id);
    expect(ids).not.toContain(futbol5.id);
    expect(ids).not.toContain(futbol7.id);
  });

  it('trae lo necesario para agrupar: tamaño, si es la entera y el grupo', async () => {
    const r = await listar(SEC);
    const entera = r.body.find((c: any) => c.id === c1.entera.id);
    const parte = r.body.find((c: any) => c.id === c1.partes[0].id);
    expect(entera).toMatchObject({ jugadores: 9, esEntera: true, grupo: { nombre: 'CANCHA 1' } });
    expect(parte).toMatchObject({ jugadores: 6, esEntera: false, grupo: { id: entera.grupo.id, nombre: 'CANCHA 1' } });
  });

  it('el tercero queda como estaba: el pádel', async () => {
    expect((await listar(TER)).body.map((c: any) => c.id)).toEqual([padel.id]);
  });

  it('una cancha desactivada no aparece', async () => {
    await getPrisma().cancha.update({ where: { id: c2.entera.id }, data: { activa: false } });
    expect((await listar(SEC)).body.map((c: any) => c.id)).not.toContain(c2.entera.id);
  });
});

describe('abrir una cuenta según el mostrador', () => {
  it('el secundario abre en la cancha de 9 y en las de 6', async () => {
    await expect(buffetCuentaService.abrir(SEC, c1.entera.id)).resolves.toMatchObject({ canchaId: c1.entera.id });
    await expect(buffetCuentaService.abrir(SEC, c2.partes[1].id)).resolves.toMatchObject({ canchaId: c2.partes[1].id });
  });

  it('el secundario no abre en una cancha de fútbol 5 o 7: solo las de 6 y de 9', async () => {
    await expect(buffetCuentaService.abrir(SEC, futbol5.id)).rejects.toThrow(/6 y de 9/);
    await expect(buffetCuentaService.abrir(SEC, futbol7.id)).rejects.toThrow(/6 y de 9/);
  });

  it('el secundario no abre en pádel', async () => {
    await expect(buffetCuentaService.abrir(SEC, padel.id)).rejects.toThrow(/fútbol/i);
  });

  it('el principal no abre en fútbol (sigue siendo solo pádel)', async () => {
    await expect(buffetCuentaService.abrir(PRI, c1.entera.id)).rejects.toThrow(/pádel/i);
    await expect(buffetCuentaService.abrir(PRI, padel.id)).resolves.toBeTruthy();
  });

  it('el tercero no cambia: pádel sí, fútbol no', async () => {
    await expect(buffetCuentaService.abrir(TER, padel.id)).resolves.toBeTruthy();
    await expect(buffetCuentaService.abrir(TER, c1.partes[0].id)).rejects.toThrow(/pádel/i);
  });

  it('por HTTP la regla es la misma', async () => {
    const ok = await supertest(app).post('/buffet/cuentas').set('x-buffet-key', KEY).set('x-mostrador', tokens[SEC]).send({ canchaId: c1.partes[0].id });
    expect(ok.status).toBe(201);
    const mal = await supertest(app).post('/buffet/cuentas').set('x-buffet-key', KEY).set('x-mostrador', tokens[SEC]).send({ canchaId: padel.id });
    expect(mal.status).toBe(422);
  });

  it('una cuenta por cancha, pero la de 9 y una de sus partes pueden tener cuenta a la vez', async () => {
    await buffetCuentaService.abrir(SEC, c1.partes[0].id);
    await expect(buffetCuentaService.abrir(SEC, c1.partes[0].id)).rejects.toThrow(/ya tiene una cuenta abierta/);
    await expect(buffetCuentaService.abrir(SEC, c1.entera.id)).resolves.toBeTruthy();
  });
});

describe('la reserva en curso se encuentra aunque esté cargada en la entera o en una parte', () => {
  it('reserva en la cancha de 9, cuenta abierta en una parte de 6', async () => {
    const r = await reservaEnCurso(c1.entera.id);
    const cuenta = await buffetCuentaService.abrir(SEC, c1.partes[1].id);
    expect(cuenta.reserva).toMatchObject({ clienteNombre: 'Facundo' });
    expect((await getPrisma().cuentaBuffet.findUniqueOrThrow({ where: { id: cuenta.id } })).reservaId).toBe(r.id);
  });

  it('reserva en una parte de 6, cuenta abierta en la de 9', async () => {
    const r = await reservaEnCurso(c1.partes[2].id);
    const cuenta = await buffetCuentaService.abrir(SEC, c1.entera.id);
    expect((await getPrisma().cuentaBuffet.findUniqueOrThrow({ where: { id: cuenta.id } })).reservaId).toBe(r.id);
  });

  it('una reserva de otra parte no se mezcla: la 1/1 no toma la reserva de la 1/2', async () => {
    await reservaEnCurso(c1.partes[1].id);
    const cuenta = await buffetCuentaService.abrir(SEC, c1.partes[0].id);
    expect(cuenta.reserva).toBeNull();
  });

  it('una reserva de la otra cancha de 9 no se mezcla', async () => {
    await reservaEnCurso(c2.entera.id);
    const cuenta = await buffetCuentaService.abrir(SEC, c1.entera.id);
    expect(cuenta.reserva).toBeNull();
  });

  it('en pádel sigue igual: la reserva de esa cancha', async () => {
    const r = await reservaEnCurso(padel.id);
    const cuenta = await buffetCuentaService.abrir(PRI, padel.id);
    expect((await getPrisma().cuentaBuffet.findUniqueOrThrow({ where: { id: cuenta.id } })).reservaId).toBe(r.id);
  });
});
