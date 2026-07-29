import { describe, it, expect } from 'vitest';
import { parseEnv } from '../../src/config/env.js';

describe('parseEnv', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    JWT_SECRET: 'a'.repeat(32),
    SERVICE_API_KEY: 'svc',
    BUFFET_API_KEY: 'buffet-svc',
    ADMIN_SEED_EMAIL: 'a@b.com',
    ADMIN_SEED_PASSWORD: 'pw',
  };
  it('applies defaults', () => {
    const env = parseEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.TZ_NEGOCIO).toBe('America/Argentina/Buenos_Aires');
    expect(env.CANCELACION_ANTICIPACION_MINUTOS).toBe(10);
    expect(env.SENA_TIMEOUT_MINUTOS).toBe(30);
  });
  it('throws when JWT_SECRET too short', () => {
    expect(() => parseEnv({ ...base, JWT_SECRET: 'short' })).toThrow();
  });

  it('applies seña defaults', () => {
    const env = parseEnv(base);
    expect(env.SENA_MODO).toBe('porcentaje');
    expect(env.SENA_PORCENTAJE).toBe(50);
    expect(env.SENA_MONTO_FIJO).toBe(5000);
    expect(env.SENA_CBU).toBe('');
  });

  it('coerces seña overrides and rejects bad porcentaje', () => {
    const env = parseEnv({ ...base, SENA_MODO: 'fijo', SENA_PORCENTAJE: '30', SENA_MONTO_FIJO: '8000' });
    expect(env.SENA_MODO).toBe('fijo');
    expect(env.SENA_PORCENTAJE).toBe(30);
    expect(env.SENA_MONTO_FIJO).toBe(8000);
    expect(() => parseEnv({ ...base, SENA_PORCENTAJE: '150' })).toThrow();
  });
});
