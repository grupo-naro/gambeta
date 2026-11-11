import { describe, it, expect } from 'vitest';
import { dashboardHref, normalizarVista } from './dashboard-vista';

describe('normalizarVista', () => {
  it('buffet y academia son esas vistas; todo lo demás es canchas', () => {
    expect(normalizarVista('buffet')).toBe('buffet');
    expect(normalizarVista('academia')).toBe('academia');
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

  it('con una fecha elegida lleva las fechas; un solo día no repite "hasta"', () => {
    expect(dashboardHref({ periodo: 'fecha', vista: 'buffet', desde: '2026-11-04' })).toBe('/dashboard?periodo=fecha&vista=buffet&desde=2026-11-04');
    expect(dashboardHref({ periodo: 'fecha', vista: 'buffet', desde: '2026-11-04', hasta: '2026-11-04' })).toBe('/dashboard?periodo=fecha&vista=buffet&desde=2026-11-04');
    expect(dashboardHref({ periodo: 'fecha', vista: 'academia', desde: '2026-11-02', hasta: '2026-11-06' })).toBe('/dashboard?periodo=fecha&vista=academia&desde=2026-11-02&hasta=2026-11-06');
  });

  it('las fechas se ignoran si el período no es "fecha"', () => {
    expect(dashboardHref({ periodo: '7', vista: 'canchas', desde: '2026-11-04' })).toBe('/dashboard?periodo=7&vista=canchas');
  });
});
