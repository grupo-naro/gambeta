import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/env.js', () => ({
  getEnv: () => ({ JWT_SECRET: 'a'.repeat(32), JWT_EXPIRES_IN: '12h', SERVICE_API_KEY: 'svc' }),
}));

import { signAdminToken, verifyAdminToken } from '../../src/services/auth.service.js';
import { authApiKey } from '../../src/middlewares/authApiKey.js';
import { AppError } from '../../src/utils/errors.js';

describe('auth tokens', () => {
  it('signs and verifies an admin token', () => {
    const token = signAdminToken({ adminId: '1', email: 'a@b.com', rol: 'ADMIN' });
    const p = verifyAdminToken(token);
    expect(p.adminId).toBe('1');
    expect(p.email).toBe('a@b.com');
  });
  it('rejects a tampered token', () => {
    expect(() => verifyAdminToken('garbage')).toThrow(AppError);
  });
});

function run(mw: any, req: any) {
  return new Promise<any>((resolve) => mw(req, {}, (err?: any) => resolve(err)));
}

describe('authApiKey', () => {
  it('accepts the right key', async () => {
    const req: any = { header: (h: string) => (h === 'x-api-key' ? 'svc' : undefined) };
    const err = await run(authApiKey, req);
    expect(err).toBeUndefined();
    expect(req.principal).toEqual({ kind: 'service' });
  });
  it('rejects a wrong key', async () => {
    const req: any = { header: () => 'nope' };
    const err = await run(authApiKey, req);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(401);
  });
});
