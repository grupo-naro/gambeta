import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validate } from '../../src/middlewares/validate.js';
import { AppError } from '../../src/utils/errors.js';

function run(mw: any, req: any) {
  return new Promise<{ err?: any }>((resolve) => {
    mw(req, {}, (err?: any) => resolve({ err }));
  });
}

describe('validate', () => {
  const schema = z.object({ body: z.object({ nombre: z.string() }) });

  it('passes valid request and assigns parsed data', async () => {
    const req: any = { body: { nombre: 'x' }, query: {}, params: {} };
    const { err } = await run(validate(schema), req);
    expect(err).toBeUndefined();
    expect(req.valid.body.nombre).toBe('x');
  });

  it('forwards a 400 AppError on invalid request', async () => {
    const req: any = { body: {}, query: {}, params: {} };
    const { err } = await run(validate(schema), req);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(400);
  });
});
