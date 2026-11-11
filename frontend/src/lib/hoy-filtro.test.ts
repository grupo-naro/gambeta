import { describe, it, expect } from 'vitest';
import { coincideConFiltro, deporteDe, deportesDe } from './hoy-filtro';

const f5 = { id: 'c1', tipo: 'futbol5' };
const f7 = { id: 'c4', tipo: 'futbol7' };
const futbol = { id: 'c6', tipo: 'futbol' };
const padel = { id: 'p1', tipo: 'padel' };

describe('deporteDe', () => {
  it('los tipos de fútbol viejos (futbol5, futbol7…) son fútbol; el pádel es pádel', () => {
    expect(deporteDe('futbol5')).toBe('futbol');
    expect(deporteDe('futbol7')).toBe('futbol');
    expect(deporteDe('futbol')).toBe('futbol');
    expect(deporteDe('padel')).toBe('padel');
    expect(deporteDe('Padel')).toBe('padel');
  });
});

describe('coincideConFiltro', () => {
  it('sin filtro entran todas', () => {
    for (const c of [f5, f7, padel]) expect(coincideConFiltro(c, { deporte: null, canchaId: null })).toBe(true);
  });

  it('por deporte: solo las canchas de ese deporte', () => {
    const fut = { deporte: 'futbol', canchaId: null };
    expect([f5, f7, futbol].every((c) => coincideConFiltro(c, fut))).toBe(true);
    expect(coincideConFiltro(padel, fut)).toBe(false);
    expect(coincideConFiltro(padel, { deporte: 'padel', canchaId: null })).toBe(true);
    expect(coincideConFiltro(f5, { deporte: 'padel', canchaId: null })).toBe(false);
  });

  it('por cancha: solo esa, aunque el deporte también esté puesto', () => {
    expect(coincideConFiltro(f5, { deporte: 'futbol', canchaId: 'c1' })).toBe(true);
    expect(coincideConFiltro(f7, { deporte: 'futbol', canchaId: 'c1' })).toBe(false);
  });

  it('un turno de una cancha desconocida solo entra sin filtro', () => {
    expect(coincideConFiltro(undefined, { deporte: null, canchaId: null })).toBe(true);
    expect(coincideConFiltro(undefined, { deporte: 'futbol', canchaId: null })).toBe(false);
  });
});

describe('deportesDe', () => {
  it('lista cada deporte una sola vez', () => {
    expect(deportesDe([f5, f7, padel, { id: 'p2', tipo: 'padel' }])).toEqual(['futbol', 'padel']);
  });
});
