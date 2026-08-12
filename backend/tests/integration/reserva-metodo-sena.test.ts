import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

let canchaId: string;
beforeEach(async () => {
  await resetTables();
  await getPrisma().configuracion.create({ data: { id: 'default' } });
  canchaId = (await getPrisma().cancha.create({
    data: { nombre: 'Cancha 1', tipo: 'futbol', precioHora: 20000 },
  })).id;
});

const svc = (r: any) => r.set('x-api-key', process.env.SERVICE_API_KEY!);

/** Mañana a las 18:00: siempre futuro y dentro del horario de apertura por defecto. */
function manana(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(d);
}

const crear = (body: Record<string, unknown>) =>
  svc(supertest(app).post('/reservas')).send({
    canchaId, whatsapp: '1136620274', nombreCliente: 'Ana',
    fecha: manana(), horaInicio: '18:00', esContacto: false, ...body,
  });

describe('método de pago de la seña', () => {
  it('guarda TRANSFERENCIA y lo devuelve', async () => {
    const res = await crear({ metodoSena: 'TRANSFERENCIA' });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('ESPERANDO_SENA');
    expect(res.body.metodoSena).toBe('TRANSFERENCIA');
  });

  it('guarda MERCADO_PAGO y lo devuelve', async () => {
    const res = await crear({ metodoSena: 'MERCADO_PAGO' });
    expect(res.body.metodoSena).toBe('MERCADO_PAGO');
  });

  it('sin método queda en null: los consumidores viejos no se rompen', async () => {
    const res = await crear({});
    expect(res.status).toBe(201);
    expect(res.body.metodoSena).toBeNull();
  });

  it('un método inventado se rechaza', async () => {
    const res = await crear({ metodoSena: 'BITCOIN' });
    expect(res.status).toBe(400);
  });

  it('si la reserva NO queda esperando seña, el método se descarta', async () => {
    // Un cliente confiable nace CONFIRMADA: no hay seña que pagar, así que guardar
    // "iba a pagar por transferencia" sería registrar una intención que nunca se ejecuta.
    await getPrisma().cliente.create({
      data: { whatsapp: '5491136620274', nombre: 'Ana', esContacto: false, confiable: true },
    });
    const res = await crear({ metodoSena: 'TRANSFERENCIA' });
    expect(res.body.estado).toBe('CONFIRMADA');
    expect(res.body.metodoSena).toBeNull();
  });
});
