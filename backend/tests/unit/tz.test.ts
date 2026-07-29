import { describe, it, expect } from 'vitest';
import { dayWindowUtc, dayOfWeekInTz, combineDateTimeUtc } from '../../src/utils/tz.js';

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
});
