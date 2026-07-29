import { describe, it, expect } from 'vitest';
import { aCanonico, previewWhatsapp } from './whatsapp';

describe('aCanonico', () => {
  it('local 10 dígitos', () => { expect(aCanonico('1136620274')).toBe('5491136620274'); });
  it('54 sin 9', () => { expect(aCanonico('+541136620274')).toBe('5491136620274'); });
  it('idempotente', () => { expect(aCanonico('5491136620274')).toBe('5491136620274'); });
  it('inválido → null', () => { expect(aCanonico('123')).toBeNull(); });
});

describe('previewWhatsapp', () => {
  it('muestra el formato lindo', () => { expect(previewWhatsapp('1136620274')).toBe('+54 9 11 3662-0274'); });
  it('inválido → null', () => { expect(previewWhatsapp('123')).toBeNull(); });
});
