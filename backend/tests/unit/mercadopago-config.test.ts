import { describe, it, expect, vi, afterEach } from 'vitest';

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
  process.env = { ...previo, ...BASE, MP_ACCESS_TOKEN: '', RESERVAS_PUBLIC_URL: '', BACKEND_PUBLIC_URL: '', ...mp };
  vi.resetModules();
  const { mercadoPagoService } = await import('../../src/services/mercadoPago.service.js');
  return mercadoPagoService.crearPreferencia(RESERVA);
}

describe('crearPreferencia dice CUÁL variable falta', () => {
  // Antes, las tres causas devolvían el mismo texto "Mercado Pago no está configurado",
  // así que el operador quedaba adivinando cuál de las tres cargar.

  it('sin MP_ACCESS_TOKEN nombra esa variable', async () => {
    await expect(crearPreferenciaCon({ RESERVAS_PUBLIC_URL: 'https://x.com', BACKEND_PUBLIC_URL: 'https://api.x.com' }))
      .rejects.toThrow(/MP_ACCESS_TOKEN/);
  });

  it('sin RESERVAS_PUBLIC_URL nombra esa variable', async () => {
    await expect(crearPreferenciaCon({ MP_ACCESS_TOKEN: 'tok', BACKEND_PUBLIC_URL: 'https://api.x.com' }))
      .rejects.toThrow(/RESERVAS_PUBLIC_URL/);
  });

  it('sin BACKEND_PUBLIC_URL nombra esa variable', async () => {
    // Esta era la que NO se validaba: sin ella, notification_url quedaba en
    // "/webhooks/mercadopago" y Mercado Pago rechazaba la preferencia con un error opaco.
    await expect(crearPreferenciaCon({ MP_ACCESS_TOKEN: 'tok', RESERVAS_PUBLIC_URL: 'https://x.com' }))
      .rejects.toThrow(/BACKEND_PUBLIC_URL/);
  });
});
