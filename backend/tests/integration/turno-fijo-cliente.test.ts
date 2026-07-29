import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest from 'supertest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { signAdminToken } from '../../src/services/auth.service.js';

let app: any; let token: string; let canchaId: string;
beforeAll(async () => { await setupTestDb(); const { buildApp } = await import('../../src/app.js'); app = buildApp(); token = signAdminToken({ adminId: 'x', email: 'a@b.com', rol: 'ADMIN' }); });
afterAll(teardownTestDb);
beforeEach(async () => { await resetTables(); canchaId = (await getPrisma().cancha.create({ data: { nombre: 'C', tipo: 'f5', precioHora: 1000, jugadores: 5 } })).id; });

const crearFijo = (whatsapp: string, clienteNombre = 'Fijo Uno') =>
  supertest(app).post('/turnos-fijos').set('authorization', `Bearer ${token}`)
    .send({ canchaId, clienteNombre, whatsapp, diaSemana: 3, horaInicio: '20:00', horaFin: '21:00' });

describe('turno fijo registra cliente', () => {
  it('crea el cliente cuando el whatsapp es nuevo', async () => {
    const r = await crearFijo('+5491150000010', 'Fijo Uno');
    expect(r.status).toBe(201);
    const clientes = await getPrisma().cliente.findMany({ where: { whatsapp: '5491150000010' } });
    expect(clientes).toHaveLength(1);
    expect(clientes[0].nombre).toBe('Fijo Uno');
  });

  it('no duplica ni pisa el nombre si el cliente ya existe', async () => {
    await getPrisma().cliente.create({ data: { nombre: 'Existente', whatsapp: '5491150000011' } });
    const r = await crearFijo('+5491150000011', 'Otro Nombre');
    expect(r.status).toBe(201);
    const clientes = await getPrisma().cliente.findMany({ where: { whatsapp: '5491150000011' } });
    expect(clientes).toHaveLength(1);
    expect(clientes[0].nombre).toBe('Existente');
  });
});
