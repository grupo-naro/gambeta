import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { disponibilidadService } from '../../src/services/disponibilidad.service.js';

let app: any; let canchaId: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

const FECHA = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

beforeEach(async () => {
  await resetTables();
  const p = getPrisma();
  await p.configuracion.upsert({
    where: { id: 'default' },
    // diasAnticipacionMax explícito: FECHA está a 30 días y el default de la fila (7) la rechazaría
    // por la ventana de anticipación pública, un motivo ajeno a la jornada que este archivo prueba.
    create: { id: 'default', horaApertura: '07:00', horaCierre: '01:00', horaAperturaFinde: '07:00', horaCierreFinde: '01:00', diasAnticipacionMax: 40 },
    update: { horaApertura: '07:00', horaCierre: '01:00', horaAperturaFinde: '07:00', horaCierreFinde: '01:00', diasAnticipacionMax: 40 },
  });
  const c = await p.cancha.create({ data: { nombre: 'C1', tipo: 'padel', precioHora: 30000 } });
  canchaId = c.id;
  const s = await p.sector.create({ data: { nombre: 'S1' } });
  await p.canchaSector.create({ data: { canchaId, sectorId: s.id } });
});

const crear = (horaInicio: string, whatsapp = '+5491150000000') =>
  supertest(app).post('/reservas').set('x-api-key', 'svc').send({
    canchaId, whatsapp, nombreCliente: 'Juan', esContacto: true, fecha: FECHA, horaInicio,
  });

describe('reservar dentro de la jornada', () => {
  it('se puede reservar el turno de las 00:00', async () => {
    const res = await crear('00:00');
    expect(res.status).toBe(201);
  });

  it('ese turno se guarda con el instante del día siguiente', async () => {
    const res = await crear('00:00');
    const r = await getPrisma().reserva.findUnique({ where: { id: res.body.id } });
    const esperado = new Date(`${FECHA}T00:00:00.000-03:00`);
    esperado.setDate(esperado.getDate() + 1);
    expect(r!.fechaInicio.toISOString()).toBe(esperado.toISOString());
  });

  it('una vez reservado, la grilla DEJA de ofrecerlo', async () => {
    // Este es el caso que prueba que la ventana de ocupación se migró de verdad. Si la grilla
    // sigue preguntando por 24 horas, el turno de las 00:00 cae afuera y se ofrece igual.
    await crear('00:00');
    const { slots } = await disponibilidadService.listar(canchaId, FECHA);
    expect(slots.map((s) => s.horaInicio)).not.toContain('00:00');
  });

  it('rechaza un turno que termina después del cierre', async () => {
    const res = await crear('00:30');
    expect(res.status).toBe(422);
  });
});
