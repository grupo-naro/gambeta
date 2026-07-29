import { describe, it, expect } from 'vitest';
import { normalizarWhatsapp } from '../../src/utils/whatsapp.js';

describe('normalizarWhatsapp', () => {
  it('local de 10 dígitos → 549 + local', () => {
    expect(normalizarWhatsapp('1136620274')).toBe('5491136620274');
  });
  it('con espacios y guiones', () => {
    expect(normalizarWhatsapp('11 3662-0274')).toBe('5491136620274');
  });
  it('ya canónico (549 + 10) es idempotente', () => {
    expect(normalizarWhatsapp('5491136620274')).toBe('5491136620274');
  });
  it('con + y 9', () => {
    expect(normalizarWhatsapp('+54 9 11 3662-0274')).toBe('5491136620274');
  });
  it('54 + local sin el 9', () => {
    expect(normalizarWhatsapp('+541136620274')).toBe('5491136620274');
  });
  it('con 0 troncal adelante', () => {
    expect(normalizarWhatsapp('01136620274')).toBe('5491136620274');
  });
  it('con prefijo internacional 00', () => {
    expect(normalizarWhatsapp('005491136620274')).toBe('5491136620274');
  });
  it('rechaza basura / muy corto / vacío', () => {
    expect(normalizarWhatsapp('123')).toBeNull();
    expect(normalizarWhatsapp('')).toBeNull();
    expect(normalizarWhatsapp('hola')).toBeNull();
  });
});
