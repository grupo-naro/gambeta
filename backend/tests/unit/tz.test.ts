import { describe, it, expect, vi } from 'vitest';
import { dayWindowUtc, dayOfWeekInTz, combineDateTimeUtc, hoyEnTz, sumarDias } from '../../src/utils/tz.js';

const TZ = 'America/Argentina/Buenos_Aires';

describe('tz', () => {
  it('combines a local date + HH:MM into the correct UTC instant', () => {
    const utc = combineDateTimeUtc('2026-06-12', '08:00', TZ);
    expect(utc.toISOString()).toBe('2026-06-12T11:00:00.000Z');
  });
  it('returns day-of-week for the local date', () => {
    expect(dayOfWeekInTz('2026-06-12', TZ)).toBe(5);
  });
  it('day window covers local midnight to midnight in UTC', () => {
    const { start, end } = dayWindowUtc('2026-06-12', TZ);
    expect(start.toISOString()).toBe('2026-06-12T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-13T03:00:00.000Z');
  });

  it('sumarDias hace aritmética de calendario, incluso cruzando de mes', () => {
    expect(sumarDias('2026-08-26', 7)).toBe('2026-09-02');
    expect(sumarDias('2026-12-28', 7)).toBe('2027-01-04');
    expect(sumarDias('2026-02-25', 7)).toBe('2026-03-04');
    expect(sumarDias('2026-08-26', 0)).toBe('2026-08-26');
  });

  it('hoyEnTz devuelve el día local, no el UTC', () => {
    // 2026-08-27T01:30:00Z es todavía el 26 en Buenos Aires (UTC-3). Es exactamente el caso
    // que rompe usar la fecha UTC como si fuera la del negocio.
    //
    // Va con vi.setSystemTime y NO pisando Date.now: en Node `new Date()` lee el reloj interno
    // sin pasar por Date.now(), así que reemplazar Date.now no afectaría a hoyEnTz y el test
    // pasaría por accidente, midiendo el día real de la corrida.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T01:30:00.000Z'));
    try {
      expect(hoyEnTz(TZ)).toBe('2026-08-26');
      expect(hoyEnTz('UTC')).toBe('2026-08-27');
    } finally {
      vi.useRealTimers();
    }
  });
});
