import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { aFechaUtc, hoyEnTz, diaSiguiente } from '../../src/services/suscripcion.vigencia.js';

let app: any;
const TZ = 'America/Argentina/Buenos_Aires';

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);
beforeEach(resetTables);

const admin = () => signAdminToken({ adminId: 'a1', email: 'a@a.com', rol: 'ADMIN' });

describe('GET /suscripciones', () => {
  it('deriva ACTIVA / VENCIDA / CANCELADA sin persistir "vencida"', async () => {
    const hoy = hoyEnTz(TZ);
    const manana = diaSiguiente(hoy);
    const cA = await getPrisma().cliente.create({ data: { nombre: 'Activa', whatsapp: '+5491100000030' } });
    const cV = await getPrisma().cliente.create({ data: { nombre: 'Vencida', whatsapp: '+5491100000031' } });
    const cC = await getPrisma().cliente.create({ data: { nombre: 'Cancelada', whatsapp: '+5491100000032' } });

    await getPrisma().suscripcion.create({ data: { clienteId: cA.id, inicio: aFechaUtc('2026-01-01'), vencimiento: aFechaUtc(manana) } });
    await getPrisma().suscripcion.create({ data: { clienteId: cV.id, inicio: aFechaUtc('2026-01-01'), vencimiento: aFechaUtc('2026-01-31') } });
    await getPrisma().suscripcion.create({ data: { clienteId: cC.id, inicio: aFechaUtc('2026-01-01'), vencimiento: aFechaUtc(manana), estado: 'CANCELADA' } });

    const res = await supertest(app).get('/suscripciones').set('authorization', `Bearer ${admin()}`);
    expect(res.status).toBe(200);
    const porCliente = Object.fromEntries(res.body.map((s: any) => [s.cliente.nombre, s.estadoVista]));
    expect(porCliente).toEqual({ Activa: 'ACTIVA', Vencida: 'VENCIDA', Cancelada: 'CANCELADA' });
    // "VENCIDA" es derivado: en la DB sigue siendo ACTIVA
    const enDb = await getPrisma().suscripcion.findFirst({ where: { clienteId: cV.id } });
    expect(enDb!.estado).toBe('ACTIVA');
  });

  it('devuelve las fechas como YYYY-MM-DD y cuenta los turnos bonificados', async () => {
    const c = await getPrisma().cliente.create({ data: { nombre: 'Socio', whatsapp: '+5491100000033' } });
    const cancha = await getPrisma().cancha.create({ data: { nombre: 'C1', tipo: 'f5', precioHora: 10000, jugadores: 5 } });
    const s = await getPrisma().suscripcion.create({
      data: { clienteId: c.id, inicio: aFechaUtc('2026-08-01'), vencimiento: aFechaUtc('2026-08-31') },
    });
    await getPrisma().reserva.create({
      data: {
        canchaId: cancha.id, clienteId: c.id, estado: 'CONFIRMADA', esContacto: false, monto: 0,
        montoLista: 10000, suscripcionId: s.id,
        fechaInicio: new Date('2026-08-10T20:00:00.000Z'), fechaFin: new Date('2026-08-10T21:00:00.000Z'),
      },
    });
    const res = await supertest(app).get('/suscripciones').set('authorization', `Bearer ${admin()}`);
    expect(res.body[0].inicio).toBe('2026-08-01');
    expect(res.body[0].vencimiento).toBe('2026-08-31');
    expect(res.body[0].turnosBonificados).toBe(1);
  });
});
