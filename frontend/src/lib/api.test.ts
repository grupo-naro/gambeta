import { describe, it, expect } from 'vitest';
import { parseApiError } from '@/lib/api';

describe('parseApiError', () => {
  it('extracts error.message from the backend envelope', () => {
    expect(parseApiError({ error: { message: 'El horario ya está reservado' } }, 409))
      .toBe('El horario ya está reservado');
  });
  it('falls back to a generic message by status when no envelope', () => {
    expect(parseApiError(null, 500)).toMatch(/error/i);
  });
});
