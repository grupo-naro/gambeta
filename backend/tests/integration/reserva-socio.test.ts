import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { aFechaUtc, hoyEnTz, sumarUnMes } from '../../src/services/suscripcion.vigencia.js';

let app: any;
let canchaId: string;
const TZ = 'America/Argentina/Buenos_Aires';

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C1', tipo: 'f5', precioHora: 12000, jugadores: 5 } })).id;
  await getPrisma().configuracion.create({ data: { id: 'default' } });
});

/** Fecha futura dentro del horario de apertura, para que el slot sea válido. */
function manana(): string {
  const d = new Date(Date.now() + 86400000);
  return d.toISOString().slice(0, 10);
}

async function reservar(whatsapp: string) {
  return supertest(app).post('/reservas').set('x-api-key', 'svc').send({
    canchaId, whatsapp, nombreCliente: 'Socio', esContacto: false,
    fecha: manana(), horaInicio: '18:00',
  });
}

describe('reserva de un socio', () => {
  it('queda CONFIRMADA, con monto 0, montoLista y sin Pago', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp: '5491178000001' } });
    const hoy = hoyEnTz(TZ);
    const s = await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc(hoy), vencimiento: aFechaUtc(sumarUnMes(hoy)) },
    });

    const res = await reservar('5491178000001');
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('CONFIRMADA');
    expect(Number(res.body.monto)).toBe(0);
    expect(Number(res.body.montoLista)).toBe(12000);
    expect(res.body.suscripcionId).toBe(s.id);
    expect(res.body.montoSena).toBeNull();
    expect(await getPrisma().pago.count()).toBe(0);
  });

  it('un cliente sin suscripcion sigue el flujo normal (sin regresion)', async () => {
    const res = await reservar('5491178000002');
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('ESPERANDO_SENA');
    expect(Number(res.body.monto)).toBe(12000);
    expect(res.body.suscripcionId).toBeNull();
    expect(res.body.montoLista).toBeNull();
    expect(await getPrisma().pago.count()).toBe(1);
  });

  it('con la suscripcion vencida vuelve al flujo con seña', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Ex socio', whatsapp: '5491178000003' } });
    await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc('2026-01-01'), vencimiento: aFechaUtc('2026-01-31') },
    });
    const res = await reservar('5491178000003');
    expect(res.body.estado).toBe('ESPERANDO_SENA');
    expect(Number(res.body.monto)).toBe(12000);
  });

  it('la reserva bonificada queda con saldo 0 en el listado', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp: '5491178000004' } });
    const hoy = hoyEnTz(TZ);
    await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc(hoy), vencimiento: aFechaUtc(sumarUnMes(hoy)) },
    });
    await reservar('5491178000004');
    const { reservaService } = await import('../../src/services/reserva.service.js');
    const lista = await reservaService.list({ fecha: manana() });
    expect(lista[0].pagado).toBe(0);
    expect(lista[0].saldo).toBe(0);
  });
});
