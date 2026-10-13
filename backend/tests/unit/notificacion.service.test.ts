import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/services/evolution.service.js', () => ({
  evolutionService: { enviarWhatsapp: vi.fn().mockResolvedValue(true) },
}));

import { evolutionService } from '../../src/services/evolution.service.js';
import {
  mensajeReservaConfirmada,
  mensajeComprobantePendiente,
  notificacionService,
} from '../../src/services/notificacion.service.js';

const TZ = 'America/Argentina/Buenos_Aires';
// 2030-03-15 20:00 hora Argentina (UTC-3) = 23:00Z. Fecha lejana: nunca es "hoy" ni "mañana".
const fechaInicio = new Date('2030-03-15T23:00:00Z');

const datos = {
  nombreCliente: 'Juan',
  whatsapp: '5491112345678',
  canchaNombre: 'Cancha 1',
  fechaInicio,
  montoSena: 5000,
};

describe('mensajes', () => {
  it('confirmación al cliente: nombre, cancha, día y hora', () => {
    const t = mensajeReservaConfirmada(datos, TZ);
    expect(t).toContain('Juan');
    expect(t).toContain('Cancha 1');
    expect(t).toContain('viernes 15/03');
    expect(t).toContain('20:00');
  });

  it('aviso al encargado: quién, qué turno, cuánto y qué hacer', () => {
    const t = mensajeComprobantePendiente(datos, TZ);
    expect(t).toContain('Juan');
    expect(t).toContain('5491112345678');
    expect(t).toContain('Cancha 1');
    expect(t).toContain('20:00');
    expect(t).toContain('5.000');
    expect(t.toLowerCase()).toContain('comprobante');
  });
});

describe('notificacionService', () => {
  const enviar = evolutionService.enviarWhatsapp as ReturnType<typeof vi.fn>;
  beforeEach(() => enviar.mockClear());

  it('avisarReservaConfirmada manda el texto al whatsapp del cliente', () => {
    notificacionService.avisarReservaConfirmada(datos, TZ);
    expect(enviar).toHaveBeenCalledOnce();
    expect(enviar.mock.calls[0][0]).toBe('5491112345678');
  });

  it('avisarComprobantePendiente normaliza el número del encargado', () => {
    notificacionService.avisarComprobantePendiente(datos, '11 5958-2039', TZ);
    expect(enviar).toHaveBeenCalledOnce();
    expect(enviar.mock.calls[0][0]).toBe('5491159582039');
  });

  it('sin número de encargado válido no envía y no lanza', () => {
    expect(() => notificacionService.avisarComprobantePendiente(datos, '', TZ)).not.toThrow();
    expect(enviar).not.toHaveBeenCalled();
  });

  it('si el envío rechaza, no lanza ni deja una promesa sin atrapar', async () => {
    enviar.mockRejectedValueOnce(new Error('down'));
    expect(() => notificacionService.avisarReservaConfirmada(datos, TZ)).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
