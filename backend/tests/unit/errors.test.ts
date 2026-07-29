import { describe, it, expect } from 'vitest';
import { AppError, NotFound, Conflict, BusinessRule } from '../../src/utils/errors.js';

describe('AppError', () => {
  it('NotFound is 404', () => {
    const e = NotFound('Cancha', 'abc');
    expect(e).toBeInstanceOf(AppError);
    expect(e.status).toBe(404);
    expect(e.code).toBe('NOT_FOUND');
  });
  it('Conflict is 409', () => { expect(Conflict('overlap').status).toBe(409); });
  it('BusinessRule is 422', () => { expect(BusinessRule('past date').status).toBe(422); });
});
