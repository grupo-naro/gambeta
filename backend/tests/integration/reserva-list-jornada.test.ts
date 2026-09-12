import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { reservaService } from '../../src/services/reserva.service.js';
import { sumarDias, dayOfWeekInTz } from '../../src/utils/tz.js';

let app: any; let canchaId: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
});
afterAll(teardownTestDb);

const TZ = 'America/Argentina/Buenos_Aires';

// Primer domingo a partir de `desde` — dentro de la ventana de anticipación (diasAnticipacionMax:
// 40 más abajo), arrancando a +30 días como en el resto de los tests de este plan.
function proximoDomingo(desde: string): string {
  let f = desde;
  while (dayOfWeekInTz(f, TZ) !== 0) f = sumarDias(f, 1);
  return f;
}
const BASE = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const DOMINGO = proximoDomingo(BASE);

beforeEach(async () => {
  await resetTables();
  const p = getPrisma();
  // diasAnticipacionMax explícito: DOMINGO puede caer hasta 6 días después de BASE (+30), y el
  // default de la fila (7) lo rechazaría por la ventana de anticipación pública — un motivo ajeno
  // a la jornada que este archivo prueba.
  await p.configuracion.upsert({
    where: { id: 'default' },
    create: { id: 'default', horaApertura: '07:00', horaCierre: '01:00', horaAperturaFinde: '07:00', horaCierreFinde: '01:00', diasAnticipacionMax: 40 },
    update: { horaApertura: '07:00', horaCierre: '01:00', horaAperturaFinde: '07:00', horaCierreFinde: '01:00', diasAnticipacionMax: 40 },
  });
  const c = await p.cancha.create({ data: { nombre: 'C1', tipo: 'padel', precioHora: 30000 } });
  canchaId = c.id;
  const s = await p.sector.create({ data: { nombre: 'S1' } });
  await p.canchaSector.create({ data: { canchaId, sectorId: s.id } });
});

const crear = (fecha: string, horaInicio: string, whatsapp = '+5491150000000') =>
  supertest(app).post('/reservas').set('x-api-key', 'svc').send({
    canchaId, whatsapp, nombreCliente: 'Juan', esContacto: true, fecha, horaInicio,
  });

describe('list() con desde/hasta cubre la JORNADA de los bordes, no el día calendario', () => {
  it('el turno de las 00:00 de un domingo aparece en la semana que termina ese domingo', async () => {
    // fecha=DOMINGO, horaInicio='00:00' se guarda con el instante real del lunes 00:00 (última
    // hora de la jornada del domingo, que cierra a la 01:00). Con `end` calculado por día
    // calendario (dayWindowUtc), ese instante cae justo en el borde `lt` y queda afuera.
    const res = await crear(DOMINGO, '00:00');
    expect(res.status).toBe(201);

    const reservas = await reservaService.list({ desde: DOMINGO, hasta: DOMINGO });
    expect(reservas.map((r) => r.id)).toContain(res.body.id);
  });

  it('regresión: una semana normal (cierre 23:00, sin cruce de medianoche) sigue trayendo lo mismo', async () => {
    await getPrisma().configuracion.update({
      where: { id: 'default' },
      data: { horaApertura: '16:00', horaCierre: '23:00', horaAperturaFinde: '16:00', horaCierreFinde: '23:00' },
    });
    const lunes = sumarDias(DOMINGO, 1);
    const res = await crear(lunes, '18:00');
    expect(res.status).toBe(201);

    const desde = sumarDias(lunes, -3);
    const hasta = sumarDias(lunes, 3);
    const reservas = await reservaService.list({ desde, hasta });
    expect(reservas.map((r) => r.id)).toContain(res.body.id);
  });
});
