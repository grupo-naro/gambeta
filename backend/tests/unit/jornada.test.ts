import { describe, it, expect } from 'vitest';
import { minutoDeJornada, hhmmDeMin, instanteDeJornada, jornadaWindowUtc } from '../../src/utils/tz.js';

const TZ = 'America/Argentina/Buenos_Aires';

describe('minutoDeJornada', () => {
  it('una hora posterior a la apertura es el minuto del día', () => {
    expect(minutoDeJornada('07:00', '07:00')).toBe(420);
    expect(minutoDeJornada('23:00', '07:00')).toBe(1380);
    expect(minutoDeJornada('22:30', '07:00')).toBe(1350);
  });

  it('una hora anterior a la apertura pertenece al día siguiente', () => {
    expect(minutoDeJornada('00:00', '07:00')).toBe(1440);
    expect(minutoDeJornada('01:00', '07:00')).toBe(1500);
    expect(minutoDeJornada('02:30', '07:00')).toBe(1590);
  });

  it('compatibilidad: para las configuraciones de hoy da lo mismo que cierreMin', () => {
    // 23:00 y 00:00 son los dos cierres que el sistema ya soportaba.
    expect(minutoDeJornada('23:00', '07:00')).toBe(1380);
    expect(minutoDeJornada('00:00', '07:00')).toBe(1440);
    expect(minutoDeJornada('00:00', '16:00')).toBe(1440);
  });
});

describe('hhmmDeMin', () => {
  it('etiqueta el minuto de jornada como lo diría un reloj', () => {
    expect(hhmmDeMin(420)).toBe('07:00');
    expect(hhmmDeMin(1380)).toBe('23:00');
    expect(hhmmDeMin(1440)).toBe('00:00'); // NO "24:00"
    expect(hhmmDeMin(1500)).toBe('01:00');
    expect(hhmmDeMin(1350)).toBe('22:30');
  });
});

describe('instanteDeJornada', () => {
  it('antes de medianoche usa la propia fecha', () => {
    // 23:00 del 11 en Argentina (UTC-3) es 02:00 UTC del 12.
    expect(instanteDeJornada('2026-09-11', 1380, TZ).toISOString()).toBe('2026-09-12T02:00:00.000Z');
  });

  it('a partir de 1440 cruza al día siguiente', () => {
    // 00:00 del 12 en Argentina (UTC-3) es 03:00 UTC del 12.
    expect(instanteDeJornada('2026-09-11', 1440, TZ).toISOString()).toBe('2026-09-12T03:00:00.000Z');
    // 01:00 del 12 en Argentina es 04:00 UTC del 12.
    expect(instanteDeJornada('2026-09-11', 1500, TZ).toISOString()).toBe('2026-09-12T04:00:00.000Z');
  });

  it('el minuto 1440 NO es la medianoche del arranque del día', () => {
    // Este es el error que la función existe para evitar: formatear 1440 como "00:00" y
    // combinarlo con la misma fecha daría 24 horas antes de lo correcto.
    const arranque = instanteDeJornada('2026-09-11', 0, TZ);
    const cierre = instanteDeJornada('2026-09-11', 1440, TZ);
    expect(cierre.getTime() - arranque.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('jornadaWindowUtc', () => {
  it('una jornada que no cruza medianoche coincide con el día calendario', () => {
    const { start, end } = jornadaWindowUtc('2026-09-11', TZ, '07:00', '23:00');
    expect(start.toISOString()).toBe('2026-09-11T10:00:00.000Z'); // 07:00 AR
    expect(end.toISOString()).toBe('2026-09-12T02:00:00.000Z');   // 23:00 AR
  });

  it('una jornada que cierra a la 01:00 termina en el día siguiente', () => {
    const { start, end } = jornadaWindowUtc('2026-09-11', TZ, '07:00', '01:00');
    expect(start.toISOString()).toBe('2026-09-11T10:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-12T04:00:00.000Z');   // 01:00 AR del 12
  });
});
