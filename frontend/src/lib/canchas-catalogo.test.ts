import { describe, it, expect } from 'vitest';
import { normalizeTipo, tipoLabel, tamanoLabel } from './canchas-catalogo';

describe('normalizeTipo', () => {
  it('mapea valores legacy de fútbol al slug futbol', () => {
    expect(normalizeTipo('futbol5')).toBe('futbol');
    expect(normalizeTipo('futbol7')).toBe('futbol');
    expect(normalizeTipo('futbol11')).toBe('futbol');
    expect(normalizeTipo('futbol')).toBe('futbol');
  });
  it('respeta los deportes válidos', () => {
    expect(normalizeTipo('padel')).toBe('padel');
    expect(normalizeTipo('voley')).toBe('voley');
  });
  it('cae en otro para valores desconocidos', () => {
    expect(normalizeTipo('cualquier-cosa')).toBe('otro');
  });
});

describe('tipoLabel', () => {
  it('muestra label lindo, incluso para legacy', () => {
    expect(tipoLabel('futbol5')).toBe('Fútbol');
    expect(tipoLabel('padel')).toBe('Pádel');
    expect(tipoLabel('zzz')).toBe('Otro');
  });
});

describe('tamanoLabel', () => {
  it('0 = Otro, resto Fútbol N', () => {
    expect(tamanoLabel(0)).toBe('Otro');
    expect(tamanoLabel(6)).toBe('Fútbol 6');
  });
});
