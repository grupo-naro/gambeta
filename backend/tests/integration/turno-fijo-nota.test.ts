import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let canchaId: string;
beforeAll(async () => {
  await setupTestDb();
  const { buildApp } = await import('../../src/app.js');
  app = buildApp();
  token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' });
});
afterAll(teardownTestDb);
beforeEach(async () => {
  await resetTables();
  canchaId = (await getPrisma().cancha.create({ data: { nombre: 'Pádel 1', tipo: 'padel', precioHora: 30000 } })).id;
});

// 2030-03-13 es miércoles (diaSemana 3).
const MIERCOLES = '2030-03-13';
const alta = (extra: Record<string, unknown> = {}) =>
  supertest(app).post('/turnos-fijos').set('authorization', `Bearer ${token}`)
    .send({ canchaId, clienteNombre: 'Ana', whatsapp: '1136620274', diaSemana: 3, horaInicio: '20:00', horaFin: '21:00', ...extra });
const lista = async () => (await supertest(app).get('/turnos-fijos').set('authorization', `Bearer ${token}`)).body;

describe('nota en el turno fijo', () => {
  it('el alta guarda la nota y la lista la devuelve', async () => {
    const r = await alta({ nota: 'Trae su propia pelota' });
    expect(r.status).toBe(201);
    expect(r.body.nota).toBe('Trae su propia pelota');
    expect((await lista())[0].nota).toBe('Trae su propia pelota');
  });

  it('sin nota queda vacía (null)', async () => {
    const r = await alta();
    expect(r.status).toBe(201);
    expect(r.body.nota ?? null).toBeNull();
  });

  it('una nota solo con espacios se guarda como vacía', async () => {
    const r = await alta({ nota: '   ' });
    expect(r.status).toBe(201);
    expect(r.body.nota ?? null).toBeNull();
  });

  it('una nota de más de 500 caracteres se rechaza', async () => {
    expect((await alta({ nota: 'x'.repeat(501) })).status).toBe(400);
  });

  it('el turno que se materializa copia la nota a la reserva', async () => {
    const fijo = await alta({ nota: 'Cumple, llevan torta' });
    const r = await supertest(app).post(`/turnos-fijos/${fijo.body.id}/materializar`).set('authorization', `Bearer ${token}`).send({ fecha: MIERCOLES });
    expect(r.status).toBe(201);
    expect(r.body.notas).toBe('Cumple, llevan torta');
  });

  it('se puede cambiar la nota editando, y vaciarla', async () => {
    const fijo = await alta({ nota: 'Vieja' });
    const e1 = await supertest(app).patch(`/turnos-fijos/${fijo.body.id}`).set('authorization', `Bearer ${token}`).send({ nota: 'Nueva' });
    expect(e1.status).toBe(200);
    expect((await lista())[0].nota).toBe('Nueva');
    const e2 = await supertest(app).patch(`/turnos-fijos/${fijo.body.id}`).set('authorization', `Bearer ${token}`).send({ nota: '' });
    expect(e2.status).toBe(200);
    expect((await lista())[0].nota ?? null).toBeNull();
  });
});
