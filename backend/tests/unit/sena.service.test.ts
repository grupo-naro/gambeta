import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/services/config.service.js', () => ({
  configService: {
    get: vi.fn(),
  },
}));

// datosPago() ahora suma cobrosOnline, que sale de mercadoPagoOauthService (y ese, de la base).
// Este es un test unitario puro (sin Testcontainers): se mockea para no tocar la DB.
vi.mock('../../src/services/mercadoPagoOauth.service.js', () => ({
  mercadoPagoOauthService: {
    cobrosOnlineActivos: vi.fn().mockResolvedValue(false),
  },
}));

import { configService } from '../../src/services/config.service.js';
import { senaService } from '../../src/services/sena.service.js';

const mockConfig = (over: Record<string, unknown>) => {
  (configService.get as any).mockResolvedValue({
    senaModo: 'PORCENTAJE',
    senaPorcentaje: 50,
    senaMontoFijo: '5000',
    cbu: 'cbu1',
    alias: 'alias1',
    titular: 'Titular',
    ...over,
  });
};

describe('senaService.montoParaPrecio', () => {
  it('ignora senaModo=PORCENTAJE (anulado) y devuelve siempre el monto fijo global', async () => {
    mockConfig({ senaModo: 'PORCENTAJE', senaPorcentaje: 50, senaMontoFijo: '5000' });
    expect(await senaService.montoParaPrecio(12000)).toBe(5000);
  });
  it('rounds senaMontoFijo to nearest peso', async () => {
    mockConfig({ senaMontoFijo: '6172.6' });
    expect(await senaService.montoParaPrecio(12345)).toBe(6173);
  });
  it('fijo: returns senaMontoFijo regardless of price', async () => {
    mockConfig({ senaModo: 'FIJO', senaMontoFijo: '8000' });
    expect(await senaService.montoParaPrecio(12000)).toBe(8000);
  });
});

describe('senaService.datosPago', () => {
  it('returns mode + payment fields', async () => {
    mockConfig({});
    expect(await senaService.datosPago()).toEqual({
      modo: 'fijo',
      porcentaje: 50,
      cbu: 'cbu1',
      alias: 'alias1',
      titular: 'Titular',
      cobrosOnline: false,
    });
  });
});
