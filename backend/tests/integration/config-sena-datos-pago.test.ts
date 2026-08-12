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
beforeEach(resetTables);

const pedir = () => supertest(app).get('/config/sena').set('x-api-key', process.env.SERVICE_API_KEY!);

describe('GET /config/sena', () => {
  it('devuelve el whatsapp del comprobante y el plazo de la seña', async () => {
    await getPrisma().configuracion.create({
      data: { id: 'default', adminWhatsapp: '5491136620274', alias: 'complejo.mp', cbu: '0000003100010000000001', titular: 'Complejo SA' },
    });
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(res.body.adminWhatsapp).toBe('5491136620274');
    expect(res.body.senaTimeoutMinutos).toBe(Number(process.env.SENA_TIMEOUT_MINUTOS ?? 30));
  });

  it('con alias o CBU cargado, la transferencia está disponible', async () => {
    await getPrisma().configuracion.create({ data: { id: 'default', alias: 'complejo.mp' } });
    expect((await pedir()).body.transferenciaDisponible).toBe(true);
  });

  it('solo con CBU también alcanza', async () => {
    await getPrisma().configuracion.create({ data: { id: 'default', cbu: '0000003100010000000001' } });
    expect((await pedir()).body.transferenciaDisponible).toBe(true);
  });

  it('sin alias ni CBU, no se puede transferir', async () => {
    await getPrisma().configuracion.create({ data: { id: 'default' } });
    expect((await pedir()).body.transferenciaDisponible).toBe(false);
  });

  it('espacios en blanco no cuentan como datos cargados', async () => {
    // Si contaran, el sitio ofrecería transferencia y mostraría un alias vacío.
    await getPrisma().configuracion.create({ data: { id: 'default', alias: '   ', cbu: '  ' } });
    expect((await pedir()).body.transferenciaDisponible).toBe(false);
  });

  it('no se rompe lo que ya devolvía', async () => {
    await getPrisma().configuracion.create({ data: { id: 'default', alias: 'complejo.mp', titular: 'Complejo SA' } });
    const res = await pedir();
    expect(res.body.alias).toBe('complejo.mp');
    expect(res.body.titular).toBe('Complejo SA');
    expect(res.body).toHaveProperty('cobrosOnline');
  });

  it('adminWhatsapp en formato local sale canonizado', async () => {
    // El validador de Configuracion.adminWhatsapp solo exige 8+ caracteres, así que el admin
    // puede haber cargado el formato local (como en cualquier otro formulario del proyecto). El
    // sitio arma el link de wa.me con lo que devuelve este endpoint, así que tiene que salir
    // canónico de acá, no crudo.
    await getPrisma().configuracion.create({ data: { id: 'default', adminWhatsapp: '11 3662 0274' } });
    expect((await pedir()).body.adminWhatsapp).toBe('5491136620274');
  });

  it('adminWhatsapp impresentable sale vacío, no roto', async () => {
    // Un número que no se puede canonizar nunca debería llegar al sitio: ahí arma un link de
    // wa.me que no existe y el cliente cree que mandó el comprobante sin haberlo hecho.
    await getPrisma().configuracion.create({ data: { id: 'default', adminWhatsapp: 'no es un telefono' } });
    expect((await pedir()).body.adminWhatsapp).toBe('');
  });
});
