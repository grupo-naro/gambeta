import { describe, it, expect } from 'vitest';
import { nombreOrigen, nombreEtiqueta } from './origen';

describe('nombreOrigen', () => {
  it('traduce cada tipo a algo legible', () => {
    expect(nombreOrigen('WHATSAPP')).toBe('WhatsApp');
    expect(nombreOrigen('QR')).toBe('QR');
    expect(nombreOrigen('REDES')).toBe('Redes');
    expect(nombreOrigen('LANDING')).toBe('Landing');
    expect(nombreOrigen('DIRECTO')).toBe('Directo');
    expect(nombreOrigen('OTRO')).toBe('Otro');
  });
});

describe('nombreEtiqueta', () => {
  it('la visita sin etiqueta se muestra como directa, no como un guion suelto', () => {
    expect(nombreEtiqueta(null)).toBe('(sin link)');
  });
  it('la etiqueta se muestra tal cual: es lo que está impreso en el QR', () => {
    expect(nombreEtiqueta('ig-bio')).toBe('ig-bio');
  });
});
