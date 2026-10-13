import { describe, it, expect, afterEach, vi } from 'vitest';
import { assertReservasAbiertas, limiteAnticipacion } from '../../src/services/reserva.service.js';
import { AppError } from '../../src/utils/errors.js';
import { parseEnv } from '../../src/config/env.js';

describe('assertReservasAbiertas', () => {
  it('sin fecha de apertura no restringe nada', () => {
    expect(() => assertReservasAbiertas('2026-10-20', '')).not.toThrow();
  });

  it('rechaza un turno anterior a la apertura, nombrando la fecha', () => {
    expect(() => assertReservasAbiertas('2026-10-31', '2026-11-01')).toThrow(AppError);
    expect(() => assertReservasAbiertas('2026-10-31', '2026-11-01')).toThrow('01/11');
  });

  it('acepta el primer día de apertura y los posteriores', () => {
    expect(() => assertReservasAbiertas('2026-11-01', '2026-11-01')).not.toThrow();
    expect(() => assertReservasAbiertas('2026-11-15', '2026-11-01')).not.toThrow();
  });
});

describe('limiteAnticipacion con apertura', () => {
  const TZ = 'America/Argentina/Buenos_Aires';
  const cfg = { diasAnticipacionMax: 7, horaApertura: '16:00', horaCierre: '23:00', horaAperturaFinde: '16:00', horaCierreFinde: '00:00' };
  afterEach(() => vi.useRealTimers());
  const ahora = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };

  it('antes de abrir, la ventana cuenta desde la apertura (si no, el 1/11 sería inalcanzable)', () => {
    ahora('2026-10-15T15:00:00Z');
    expect(limiteAnticipacion(cfg, TZ).ymd).toBe('2026-10-22');
    expect(limiteAnticipacion(cfg, TZ, '2026-11-01').ymd).toBe('2026-11-08');
  });

  it('ya abierto, la apertura no cambia nada', () => {
    ahora('2026-11-05T15:00:00Z');
    expect(limiteAnticipacion(cfg, TZ, '2026-11-01').ymd).toBe('2026-11-12');
  });
});

describe('RESERVAS_DESDE en el env', () => {
  const base = {
    DATABASE_URL: 'x', JWT_SECRET: 'x'.repeat(32), SERVICE_API_KEY: 'k',
    ADMIN_SEED_EMAIL: 'a@b.com', ADMIN_SEED_PASSWORD: 'p',
  };
  it('es opcional', () => {
    expect(parseEnv(base).RESERVAS_DESDE).toBe('');
  });
  it('acepta YYYY-MM-DD y rechaza otros formatos (falla al arrancar, no en silencio)', () => {
    expect(parseEnv({ ...base, RESERVAS_DESDE: '2026-11-01' }).RESERVAS_DESDE).toBe('2026-11-01');
    expect(() => parseEnv({ ...base, RESERVAS_DESDE: '01/11/2026' })).toThrow();
  });
});
