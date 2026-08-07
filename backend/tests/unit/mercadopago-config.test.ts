import { describe, it, expect, vi, afterEach } from 'vitest';

// El token ya no sale de una variable de entorno fija: ahora `client()` le pide el token al
// vendedor vía `mercadoPagoOauthService.tokenDeAcceso()`, que habla con la base.
// Este archivo es un test unitario puro (sin Testcontainers), así que ese servicio se mockea
// para no depender de una DB real.
vi.mock('../../src/services/mercadoPagoOauth.service.js', () => ({
  mercadoPagoOauthService: {
    tokenDeAcceso: vi.fn().mockResolvedValue('token-de-prueba'),
  },
}));

// `getEnv()` cachea el parseo de process.env en el primer acceso, así que cada caso
// monta el entorno y reimporta los módulos con `vi.resetModules()`.
const BASE = {
  DATABASE_URL: 'postgresql://x',
  JWT_SECRET: 'a'.repeat(32),
  SERVICE_API_KEY: 'svc',
  BUFFET_API_KEY: 'buffet-svc',
  ADMIN_SEED_EMAIL: 'a@b.com',
  ADMIN_SEED_PASSWORD: 'pw',
};

const RESERVA = { id: 'r1', montoSena: 5000, canchaNombre: 'Pádel 1' };

const previo = { ...process.env };
afterEach(() => {
  process.env = { ...previo };
  vi.resetModules();
});

async function crearPreferenciaCon(mp: Record<string, string>) {
  process.env = { ...previo, ...BASE, RESERVAS_PUBLIC_URL: '', BACKEND_PUBLIC_URL: '', ...mp };
  vi.resetModules();
  const { mercadoPagoService } = await import('../../src/services/mercadoPago.service.js');
  return mercadoPagoService.crearPreferencia(RESERVA);
}

describe('crearPreferencia dice CUÁL variable falta', () => {
  // Antes había una tercera causa (la variable fija del token de acceso) que devolvía el mismo
  // texto genérico "Mercado Pago no está configurado". Esa variable ya no existe: el token
  // sale de la cuenta vinculada, no de una variable de entorno (ver mercadoPagoOauth.service.ts).
  // Que no haya cuenta vinculada se prueba en tests/integration/mercadopago-cuenta-rutas.test.ts,
  // que sí puede tocar la base.

  it('sin RESERVAS_PUBLIC_URL nombra esa variable', async () => {
    await expect(crearPreferenciaCon({ BACKEND_PUBLIC_URL: 'https://api.x.com' }))
      .rejects.toThrow(/RESERVAS_PUBLIC_URL/);
  });

  it('sin BACKEND_PUBLIC_URL nombra esa variable', async () => {
    // Esta era la que NO se validaba: sin ella, notification_url quedaba en
    // "/webhooks/mercadopago" y Mercado Pago rechazaba la preferencia con un error opaco.
    await expect(crearPreferenciaCon({ RESERVAS_PUBLIC_URL: 'https://x.com' }))
      .rejects.toThrow(/BACKEND_PUBLIC_URL/);
  });
});
