import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';

let app: any;
let canchaId: string;
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

/**
 * Fecha RELATIVA a hoy, no literal: `crear()` rechaza reservas en el pasado con 422, así que una
 * fecha hardcodeada rompe estos tests en cuanto queda atrás. Estos 3 tests estuvieron rojos por
 * exactamente eso (tenían '2026-06-15').
 */
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

describe('seña on create', () => {
  // La seña ya NO es un porcentaje del precio: `senaService.montoParaPrecio` devuelve siempre el
  // monto fijo de `Configuracion.senaMontoFijo` (default 5000) e ignora el precio de la cancha —
  // ver el comentario "el porcentaje quedó anulado" en sena.service.ts. Este test afirmaba 6000
  // (50% de 12000), la regla vieja, y quedó desactualizado cuando se retiró el porcentaje.
  it('new client (ESPERANDO_SENA) → montoSena = monto fijo global + datosPago', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body());
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('ESPERANDO_SENA');
    expect(Number(res.body.montoSena)).toBe(5000);
    expect(res.body.datosPago).toMatchObject({ alias: 'canchitas.ortigoza', titular: 'Canchitas Ortigoza' });
    expect(res.body.datosPago.cbu).toBeTruthy();
  });

  it('known contact (CONFIRMADA) → montoSena null, no datosPago', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ esContacto: true, horaInicio: '19:00' }));
    expect(res.body.estado).toBe('CONFIRMADA');
    expect(res.body.montoSena).toBeNull();
    expect(res.body.datosPago).toBeUndefined();
  });

  it('explicit montoSena is respected', async () => {
    const res = await supertest(app).post('/reservas').set('x-api-key', 'svc').send(body({ horaInicio: '20:00', montoSena: 999 }));
    expect(Number(res.body.montoSena)).toBe(999);
  });
});

describe('GET /config/sena', () => {
  it('returns payment config for the bot (API key)', async () => {
    const res = await supertest(app).get('/config/sena').set('x-api-key', 'svc');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      modo: 'fijo',
      porcentaje: 50,
      alias: 'canchitas.ortigoza',
      titular: 'Canchitas Ortigoza',
    });
    expect(res.body.cbu).toBeTruthy();
  });

  it('401 without auth', async () => {
    const res = await supertest(app).get('/config/sena');
    expect(res.status).toBe(401);
  });
});
