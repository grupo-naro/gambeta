import { describe, it, expect } from 'vitest';
import { dashboardHref, normalizarVista } from './dashboard-vista';

describe('normalizarVista', () => {
  it('buffet es buffet; todo lo demás es canchas', () => {
    expect(normalizarVista('buffet')).toBe('buffet');
    expect(normalizarVista('canchas')).toBe('canchas');
    expect(normalizarVista(undefined)).toBe('canchas');
    expect(normalizarVista('otra')).toBe('canchas');
  });
});

describe('dashboardHref', () => {
  it('conserva período y vista', () => {
    expect(dashboardHref({ periodo: '7', vista: 'buffet' })).toBe('/dashboard?periodo=7&vista=buffet');
    expect(dashboardHref({ periodo: 'mes', vista: 'canchas' })).toBe('/dashboard?periodo=mes&vista=canchas');
  });
});
