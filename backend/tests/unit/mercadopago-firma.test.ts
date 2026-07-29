import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';

// getEnv() real (src/config/env.ts) valida y cachea TODAS las env vars requeridas
// del proyecto (DATABASE_URL, JWT_SECRET, etc.) al primer llamado del proceso, lo
// cual rompe este test unitario aislado (faltan esas vars) y además impide que
// cambios a process.env.MP_WEBHOOK_SECRET entre tests tengan efecto (el resultado
// queda cacheado). Se mockea getEnv() para leer en vivo de process.env, igual que
// ya hace tests/unit/auth.test.ts. La lógica bajo test (verificarFirma: HMAC real
// vía node:crypto + WebhookSignatureValidator real del SDK) NO se mockea.
vi.mock('../../src/config/env.js', () => ({
  getEnv: () => ({ MP_WEBHOOK_SECRET: process.env.MP_WEBHOOK_SECRET ?? '' }),
}));

import { mercadoPagoService } from '../../src/services/mercadoPago.service.js';

const SECRET = 'test-secret';

function firmar(dataId: string, requestId: string, ts: string): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac('sha256', SECRET).update(manifest).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

describe('mercadoPagoService.verificarFirma', () => {
  beforeEach(() => { process.env.MP_WEBHOOK_SECRET = SECRET; });

  it('acepta una firma válida', () => {
    const ts = String(Date.now());
    const xSignature = firmar('123456', 'req-1', ts);
    const ok = mercadoPagoService.verificarFirma({ xSignature, xRequestId: 'req-1', dataId: '123456' });
    expect(ok).toBe(true);
  });

  it('rechaza una firma con el v1 alterado', () => {
    const ts = String(Date.now());
    const [tsPart] = firmar('123456', 'req-1', ts).split(',');
    const xSignature = `${tsPart},v1=${'0'.repeat(64)}`;
    const ok = mercadoPagoService.verificarFirma({ xSignature, xRequestId: 'req-1', dataId: '123456' });
    expect(ok).toBe(false);
  });

  it('rechaza si el dataId no coincide con el firmado', () => {
    const ts = String(Date.now());
    const xSignature = firmar('123456', 'req-1', ts);
    const ok = mercadoPagoService.verificarFirma({ xSignature, xRequestId: 'req-1', dataId: 'otro-id' });
    expect(ok).toBe(false);
  });

  it('rechaza si falta la firma o el dataId', () => {
    expect(mercadoPagoService.verificarFirma({ xSignature: undefined, xRequestId: 'req-1', dataId: '1' })).toBe(false);
    expect(mercadoPagoService.verificarFirma({ xSignature: 'ts=1,v1=abc', xRequestId: 'req-1', dataId: undefined })).toBe(false);
  });

  it('rechaza si MP_WEBHOOK_SECRET no está configurado', () => {
    process.env.MP_WEBHOOK_SECRET = '';
    const xSignature = firmar('123456', 'req-1', String(Date.now()));
    const ok = mercadoPagoService.verificarFirma({ xSignature, xRequestId: 'req-1', dataId: '123456' });
    expect(ok).toBe(false);
  });
});
