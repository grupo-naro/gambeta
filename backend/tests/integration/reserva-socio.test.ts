import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { aFechaUtc, hoyEnTz, sumarUnMes } from '../../src/services/suscripcion.vigencia.js';
import { SOCIOS_HABILITADO } from '../../src/config/features.js';

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

/** Fecha YYYY-MM-DD relativa a hoy (offset en días). Evita literales que envejecen mal. */
function enDias(offset: number): string {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
}

async function reservar(whatsapp: string) {
  return supertest(app).post('/reservas').set('x-api-key', 'svc').send({
    canchaId, whatsapp, nombreCliente: 'Socio', esContacto: false,
    fecha: manana(), horaInicio: '18:00',
  });
}

async function reservarStaff(whatsapp: string, extra: Record<string, unknown> = {}) {
  const token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
  return supertest(app).post('/reservas').set('authorization', `Bearer ${token}`).send({
    canchaId, whatsapp, nombreCliente: 'Socio', esContacto: false,
    fecha: manana(), horaInicio: '18:00', ...extra,
  });
}

// Socios esta apagado (ver src/config/features.ts). Estos casos verifican la bonificacion,
// asi que quedan omitidos mientras el flag este en false y vuelven solos si se reactiva.
describe.skipIf(!SOCIOS_HABILITADO)('reserva de un socio', () => {
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
    // Vencida hace tiempo: relativa a hoy, no una fecha literal (ver enDias más arriba).
    await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc(enDias(-210)), vencimiento: aFechaUtc(enDias(-180)) },
    });
    const res = await reservar('5491178000003');
    expect(res.body.estado).toBe('ESPERANDO_SENA');
    expect(Number(res.body.monto)).toBe(12000);
    expect(res.body.suscripcionId).toBeNull();
    expect(res.body.montoLista).toBeNull();
    expect(await getPrisma().pago.count()).toBe(1);
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

/** Crea un cliente con una suscripción vigente hoy, para los tests de cobro desde el panel. */
async function crearSocio(whatsapp: string) {
  const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp } });
  const hoy = hoyEnTz(TZ);
  await getPrisma().suscripcion.create({
    data: { clienteId: c.id, inicio: aFechaUtc(hoy), vencimiento: aFechaUtc(sumarUnMes(hoy)) },
  });
}

// Socios esta apagado (ver src/config/features.ts). Estos casos verifican la bonificacion,
// asi que quedan omitidos mientras el flag este en false y vuelven solos si se reactiva.
describe.skipIf(!SOCIOS_HABILITADO)('reserva de un socio creada por staff con cobro inicial (panel)', () => {
  // Agujero de dinero real: el panel calculaba la seña desde la cancha (`defaultSena`), sin saber
  // que el turno es de un socio (monto 0). Con cobroInicial='sena' terminaba asentando un Cobro
  // contra un turno gratis, y `saldo = max(0, 0 - seña) = 0` lo dejaba invisible en el panel.
  it('cobroInicial=sena no cobra nada y avisa con cobroOmitido', async () => {
    await crearSocio('5491178000005');
    const res = await reservarStaff('5491178000005', { cobroInicial: 'sena', medioCobro: 'EFECTIVO' });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('CONFIRMADA');
    expect(Number(res.body.monto)).toBe(0);
    expect(res.body.suscripcionId).toBeTruthy();
    expect(res.body.cobroOmitido).toBe(true);
    expect(await getPrisma().cobro.count()).toBe(0);
  });

  it('cobroInicial=total tampoco cobra nada y avisa con cobroOmitido', async () => {
    await crearSocio('5491178000006');
    const res = await reservarStaff('5491178000006', { cobroInicial: 'total', medioCobro: 'EFECTIVO' });
    expect(res.status).toBe(201);
    expect(Number(res.body.monto)).toBe(0);
    expect(res.body.cobroOmitido).toBe(true);
    expect(await getPrisma().cobro.count()).toBe(0);
  });
});
