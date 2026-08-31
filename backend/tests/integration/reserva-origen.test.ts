import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any; let canchaId: string;

beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 12000 } })).id;
});

// Fecha RELATIVA a hoy, no literal: `crear()` rechaza reservas en el pasado, así que una fecha
// hardcodeada rompe el test en cuanto queda atrás. Mismo helper que `sena.test.ts`.
const manana = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

const body = (over: Partial<any> = {}) => ({
  canchaId,
  whatsapp: '+5491150000000',
  nombreCliente: 'Juan',
  esContacto: false,
  fecha: manana(),
  horaInicio: '18:00',
  ...over,
});

describe('origen de la reserva', () => {
  it('guarda la etiqueta y deriva el tipo', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc')
      .send(body({ origenEtiqueta: 'ig-bio' }));
    expect(res.status).toBe(201);
    const r = await getPrisma().reserva.findUnique({ where: { id: res.body.id } });
    expect(r?.origenEtiqueta).toBe('ig-bio');
    expect(r?.origenTipo).toBe('REDES');
  });

  it('sin etiqueta las dos columnas quedan en null, no en DIRECTO', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc')
      .send(body({ horaInicio: '19:00', whatsapp: '+5491150000001' }));
    expect(res.status).toBe(201);
    const r = await getPrisma().reserva.findUnique({ where: { id: res.body.id } });
    expect(r?.origenEtiqueta).toBeNull();
    expect(r?.origenTipo).toBeNull();
  });

  it('rechaza una etiqueta con formato inválido', async () => {
    await supertest(app).post('/reservas').set('x-api-key', 'svc')
      .send(body({ horaInicio: '20:00', whatsapp: '+5491150000002', origenEtiqueta: 'IG Bio!' }))
      .expect(400);
  });
});
