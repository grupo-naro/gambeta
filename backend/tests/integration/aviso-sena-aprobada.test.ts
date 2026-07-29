import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';
import { evolutionService } from '../../src/services/evolution.service.js';

let app: any; let canchaId: string; let token: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); });
afterAll(teardownTestDb);
beforeEach(async () => {
  vi.restoreAllMocks();
  await resetTables();
  await getPrisma().configuracion.create({ data: { senaMontoFijo: 5000 } });
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'Cancha 1', tipo: 'futbol', precioHora: 20000, jugadores: 5, senaMonto: 10000 } })).id;
  const admin = await getPrisma().adminUser.create({ data: { email: 'a@test.com', passwordHash: 'x', nombre: 'A', rol: 'ADMIN' } });
  token = signAdminToken({ adminId: admin.id, email: admin.email, rol: 'ADMIN' });
});

const fut = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const crear = (whatsapp: string) =>
  supertest(app).post('/reservas').set('x-api-key', 'svc')
    .send({ canchaId, whatsapp, nombreCliente: 'Nuevo', esContacto: false, fecha: fut(), horaInicio: '18:00' });

describe('aviso de seña aprobada', () => {
  it('aprobación MANUAL (admin) envía WhatsApp al cliente con cancha y hora', async () => {
    const spy = vi.spyOn(evolutionService, 'enviarWhatsapp').mockResolvedValue(true);
    const r = await crear('5491150000050');
    expect(r.body.estado).toBe('ESPERANDO_SENA');

    const ap = await supertest(app).patch(`/reservas/${r.body.id}/aprobar-sena`).set('authorization', `Bearer ${token}`).send({});
    expect(ap.status).toBe(200);
    expect(ap.body.estado).toBe('CONFIRMADA');

    const cli = await getPrisma().cliente.findFirst();
    expect(spy).toHaveBeenCalledTimes(1);
    const [num, texto] = spy.mock.calls[0];
    expect(num).toBe(cli!.whatsapp); // robusto ante normalización del whatsapp
    expect(texto).toContain('Cancha 1');
    expect(texto).toContain('18:00');
  });

  it('aprobación del BOT (service key) NO envía WhatsApp', async () => {
    const spy = vi.spyOn(evolutionService, 'enviarWhatsapp').mockResolvedValue(true);
    const r = await crear('5491150000051');
    const ap = await supertest(app).patch(`/reservas/${r.body.id}/aprobar-sena`).set('x-api-key', 'svc').send({});
    expect(ap.status).toBe(200);
    expect(ap.body.estado).toBe('CONFIRMADA');
    expect(spy).not.toHaveBeenCalled();
  });

  it('si el envío falla, la aprobación igual queda CONFIRMADA (best-effort)', async () => {
    vi.spyOn(evolutionService, 'enviarWhatsapp').mockRejectedValue(new Error('evo down'));
    const r = await crear('5491150000052');
    const ap = await supertest(app).patch(`/reservas/${r.body.id}/aprobar-sena`).set('authorization', `Bearer ${token}`).send({});
    expect(ap.status).toBe(200);
    expect(ap.body.estado).toBe('CONFIRMADA');
  });

  it('si enviarWhatsapp lanza SÍNCRONO (no una promesa rechazada), la aprobación igual queda CONFIRMADA', async () => {
    vi.spyOn(evolutionService, 'enviarWhatsapp').mockImplementation(() => {
      throw new Error('boom sync');
    });
    const r = await crear('5491150000053');
    const ap = await supertest(app).patch(`/reservas/${r.body.id}/aprobar-sena`).set('authorization', `Bearer ${token}`).send({});
    expect(ap.status).toBe(200);
    expect(ap.body.estado).toBe('CONFIRMADA');
  });

  it('aprobación automática (notificar:true, sin adminId) también envía WhatsApp', async () => {
    const spy = vi.spyOn(evolutionService, 'enviarWhatsapp').mockResolvedValue(true);
    const r = await crear('5491150000060');
    expect(r.body.estado).toBe('ESPERANDO_SENA');

    const { reservaService } = await import('../../src/services/reserva.service.js');
    const actualizada = await reservaService.aprobarSena(r.body.id, { notificar: true }, {});
    expect(actualizada.estado).toBe('CONFIRMADA');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
