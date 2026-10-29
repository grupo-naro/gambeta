import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../../src/services/evolution.service.js', () => ({
  evolutionService: { enviarWhatsapp: vi.fn().mockResolvedValue(true) },
}));

import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { evolutionService } from '../../src/services/evolution.service.js';
import { enviarRecordatorios } from '../../src/services/recordatorio.service.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);

const enviar = vi.mocked(evolutionService.enviarWhatsapp);

// Turno: sábado 2030-03-16 20:00 AR (= 23:00Z). Recordatorio: viernes 2030-03-15 18:00 AR (= 21:00Z).
const TURNO = new Date('2030-03-16T23:00:00Z');
const ANTES = new Date('2030-03-15T20:59:00Z');
const HORA = new Date('2030-03-15T21:00:00Z');
let canchaId: string; let clienteId: string;

beforeEach(async () => {
  await resetTables();
  enviar.mockReset();
  enviar.mockResolvedValue(true);
  const p = getPrisma();
  canchaId = (await p.cancha.create({ data: { nombre: 'Cancha 1', tipo: 'padel', precioHora: 30000 } })).id;
  clienteId = (await p.cliente.create({ data: { nombre: 'Juan', whatsapp: '5491155550001' } })).id;
});

const reserva = (extra: Record<string, unknown> = {}) =>
  getPrisma().reserva.create({
    data: {
      canchaId, clienteId, estado: 'CONFIRMADA', esContacto: false, monto: 30000,
      fechaInicio: TURNO, fechaFin: new Date(TURNO.getTime() + 3600000), ...extra,
    } as any,
  });
const marca = async (id: string) => (await getPrisma().reserva.findUniqueOrThrow({ where: { id } })).recordatorioEnviadoEn;

describe('recordatorio un día antes', () => {
  it('antes de las 18:00 del día anterior no avisa', async () => {
    await reserva();
    expect(await enviarRecordatorios(ANTES)).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('a las 18:00 del día anterior avisa al cliente y deja la marca', async () => {
    const r = await reserva();
    expect(await enviarRecordatorios(HORA)).toBe(1);
    expect(enviar).toHaveBeenCalledTimes(1);
    const [numero, texto] = enviar.mock.calls[0];
    expect(numero).toBe('5491155550001');
    expect(texto).toContain('Juan');
    expect(texto).toContain('Cancha 1');
    expect(texto).toContain('20:00');
    expect(await marca(r.id)).not.toBeNull();
  });

  it('una segunda pasada no repite el aviso', async () => {
    await reserva();
    await enviarRecordatorios(HORA);
    expect(await enviarRecordatorios(new Date(HORA.getTime() + 5 * 60000))).toBe(0);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('dos pasadas simultáneas avisan una sola vez', async () => {
    await reserva();
    await Promise.all([enviarRecordatorios(HORA), enviarRecordatorios(HORA)]);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('no avisa reservas esperando seña ni canceladas', async () => {
    await reserva({ estado: 'ESPERANDO_SENA' });
    await reserva({ estado: 'CANCELADA', fechaInicio: new Date('2030-03-16T21:00:00Z'), fechaFin: new Date('2030-03-16T22:00:00Z') });
    expect(await enviarRecordatorios(HORA)).toBe(0);
  });

  it('no avisa las reservas que salen de un turno fijo', async () => {
    const fijo = await getPrisma().turnoFijo.create({ data: { canchaId, clienteNombre: 'Fijo', diaSemana: 6, horaInicio: '20:00', horaFin: '21:00' } });
    await reserva({ turnoFijoId: fijo.id });
    expect(await enviarRecordatorios(HORA)).toBe(0);
  });

  it('no avisa una reserva hecha después de la hora del recordatorio (ya la tiene fresca)', async () => {
    await reserva({ creadoEn: new Date('2030-03-15T22:00:00Z') });
    expect(await enviarRecordatorios(new Date('2030-03-15T23:00:00Z'))).toBe(0);
  });

  it('no avisa un turno que ya empezó', async () => {
    await reserva();
    expect(await enviarRecordatorios(new Date('2030-03-16T23:30:00Z'))).toBe(0);
  });

  it('si WhatsApp falla, la marca se deshace y se reintenta en la próxima pasada', async () => {
    const r = await reserva();
    enviar.mockResolvedValueOnce(false);
    expect(await enviarRecordatorios(HORA)).toBe(0);
    expect(await marca(r.id)).toBeNull();
    expect(await enviarRecordatorios(new Date(HORA.getTime() + 5 * 60000))).toBe(1);
    expect(await marca(r.id)).not.toBeNull();
  });

  it('un error al enviar una reserva no frena a las demás', async () => {
    const otro = await getPrisma().cliente.create({ data: { nombre: 'Ana', whatsapp: '5491155550002' } });
    await reserva();
    await reserva({ clienteId: otro.id, fechaInicio: new Date('2030-03-16T22:00:00Z'), fechaFin: new Date('2030-03-16T23:00:00Z') });
    enviar.mockRejectedValueOnce(new Error('boom'));
    expect(await enviarRecordatorios(HORA)).toBe(1);
  });

  it('un número inválido se salta sin intentar enviar', async () => {
    await getPrisma().cliente.update({ where: { id: clienteId }, data: { whatsapp: '123' } });
    await reserva();
    expect(await enviarRecordatorios(HORA)).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
  });
});
