import { describe, it, expect } from 'vitest';
import { clasificarOrigen } from '../../src/services/visita.service.js';

describe('clasificarOrigen', () => {
  it('las tres etiquetas que se usan hoy', () => {
    expect(clasificarOrigen('whatsapp')).toBe('WHATSAPP');
    expect(clasificarOrigen('ig-bio')).toBe('REDES');
    expect(clasificarOrigen('landing')).toBe('LANDING');
  });

  it('mira el primer segmento, así que la etiqueta puede llevar sufijo o no', () => {
    expect(clasificarOrigen('whatsapp-bot')).toBe('WHATSAPP');
    expect(clasificarOrigen('wsp-bot')).toBe('WHATSAPP');
    expect(clasificarOrigen('qr')).toBe('QR');
    expect(clasificarOrigen('qr-entrada')).toBe('QR');
    expect(clasificarOrigen('qr-cancha-1')).toBe('QR');
  });

  it('agrupa las redes', () => {
    for (const e of ['ig-bio', 'fb-post', 'tt-perfil', 'yt-video', 'redes-varias']) {
      expect(clasificarOrigen(e)).toBe('REDES');
    }
  });

  it('sin etiqueta es una visita directa', () => {
    expect(clasificarOrigen(null)).toBe('DIRECTO');
    expect(clasificarOrigen(undefined)).toBe('DIRECTO');
    expect(clasificarOrigen('')).toBe('DIRECTO');
  });

  it('una etiqueta desconocida no se pierde: cae en OTRO', () => {
    expect(clasificarOrigen('volante-papel')).toBe('OTRO');
    expect(clasificarOrigen('xyz')).toBe('OTRO');
  });
});
