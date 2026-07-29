import { describe, it, expect } from 'vitest';
import { assertTransition } from '../../src/services/reserva.service.js';
import { AppError } from '../../src/utils/errors.js';

describe('assertTransition', () => {
  it('allows ESPERANDO_SENA -> CONFIRMADA', () => {
    expect(() => assertTransition('ESPERANDO_SENA', 'CONFIRMADA')).not.toThrow();
  });
  it('rejects CANCELADA -> CONFIRMADA', () => {
    expect(() => assertTransition('CANCELADA', 'CONFIRMADA')).toThrow(AppError);
  });
  it('rejects COMPLETADA -> CANCELADA', () => {
    expect(() => assertTransition('COMPLETADA', 'CANCELADA')).toThrow(AppError);
  });
});
