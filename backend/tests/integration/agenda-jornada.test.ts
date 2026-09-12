import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { agendaService } from '../../src/services/agenda.service.js';

let app: any; let canchaId: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

const FECHA = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const SIGUIENTE = new Date(Date.now() + 31 * 86400000).toISOString().slice(0, 10);

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

describe('la agenda del día es la de la jornada', () => {
  it('el turno de las 00:00 aparece en la agenda de SU jornada, no en la del día siguiente', async () => {
    await crear('00:00');
    const agenda = await agendaService.delDia(FECHA);
    expect(agenda.reservas).toHaveLength(1);

    const agendaSiguiente = await agendaService.delDia(SIGUIENTE);
    expect(agendaSiguiente.reservas).toHaveLength(0);
  });

  it('el turno de las 23:00 sigue apareciendo en su día', async () => {
    await crear('23:00');
    expect((await agendaService.delDia(FECHA)).reservas).toHaveLength(1);
  });

  it('buscar por nombre y fecha también encuentra el turno de las 00:00', async () => {
    await crear('00:00');
    const { reservaService } = await import('../../src/services/reserva.service.js');
    const encontradas = await reservaService.buscar({ nombre: 'Juan', fecha: FECHA });
    expect(encontradas).toHaveLength(1);
  });
});
