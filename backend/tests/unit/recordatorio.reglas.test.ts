import { describe, it, expect } from 'vitest';
import { momentoRecordatorio, HORA_RECORDATORIO } from '../../src/services/recordatorio.reglas.js';
import { mensajeRecordatorio, mensajeSenaAprobada, mensajeReservaConfirmada } from '../../src/services/notificacion.service.js';

const TZ = 'America/Argentina/Buenos_Aires';

describe('momentoRecordatorio', () => {
  it('es a las 18:00 (hora Argentina) del día anterior al turno', () => {
    // Turno: sábado 2030-03-16 20:00 AR (= 23:00Z). Recordatorio: viernes 2030-03-15 18:00 AR (= 21:00Z).
    expect(momentoRecordatorio(new Date('2030-03-16T23:00:00Z'), TZ).toISOString()).toBe('2030-03-15T21:00:00.000Z');
  });

  it('un turno de madrugada cuenta por el día calendario en que ocurre', () => {
    // Turno: sábado 2030-03-16 00:30 AR (= 03:30Z). Recordatorio: viernes 2030-03-15 18:00 AR.
    expect(momentoRecordatorio(new Date('2030-03-16T03:30:00Z'), TZ).toISOString()).toBe('2030-03-15T21:00:00.000Z');
  });

  it('cruza el fin de mes', () => {
    // Turno: 1/4/2030 10:00 AR. Recordatorio: 31/3/2030 18:00 AR.
    expect(momentoRecordatorio(new Date('2030-04-01T13:00:00Z'), TZ).toISOString()).toBe('2030-03-31T21:00:00.000Z');
  });

  it('la hora fija es 18:00', () => { expect(HORA_RECORDATORIO).toBe('18:00'); });
});

describe('mensajes de aviso', () => {
  const fechaInicio = new Date('2030-03-15T23:00:00Z'); // viernes 15/03 20:00 AR
  const AVISO = 'Este número solo envía avisos';

  it('recordatorio: nombre, cancha, día, hora', () => {
    const t = mensajeRecordatorio({ nombreCliente: 'Juan', canchaNombre: 'Cancha 1', fechaInicio }, TZ);
    expect(t).toContain('Juan');
    expect(t).toContain('Cancha 1');
    expect(t).toContain('20:00');
    expect(t).toMatch(/recordamos/i);
  });

  it('todos los mensajes al cliente aclaran que el número no responde', () => {
    expect(mensajeRecordatorio({ nombreCliente: 'Juan', canchaNombre: 'Cancha 1', fechaInicio }, TZ)).toContain(AVISO);
    expect(mensajeSenaAprobada({ cancha: { nombre: 'Cancha 1' }, fechaInicio }, TZ)).toContain(AVISO);
    expect(mensajeReservaConfirmada({ nombreCliente: 'Juan', whatsapp: '5491100000000', canchaNombre: 'Cancha 1', fechaInicio, montoSena: 0 }, TZ)).toContain(AVISO);
  });
});
