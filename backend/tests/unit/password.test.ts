import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/utils/password.js';

describe('password', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('secret');
    expect(hash).not.toBe('secret');
    expect(await verifyPassword('secret', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});
