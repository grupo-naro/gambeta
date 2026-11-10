import { describe, it, expect } from 'vitest';
import { diaSinVentas, etiquetaDia, maximoDelPeriodo, porcentajeBarra } from './dashboard-buffet';
import type { BuffetDia } from './types';

const dia = (fecha: string, total: number, unidades = 0): BuffetDia => ({
  fecha, total, unidades, efectivo: total, transferencia: 0,
  mostradores: { PRINCIPAL: { unidades, total }, SECUNDARIO: { unidades: 0, total: 0 }, TERCERO: { unidades: 0, total: 0 } }, productos: [],
});

describe('etiquetaDia', () => {
  it('escribe el día y la fecha como en el resumen', () => {
    expect(etiquetaDia('2026-11-08')).toBe('dom 08/11');
    expect(etiquetaDia('2026-11-09')).toBe('lun 09/11');
    expect(etiquetaDia('2026-11-07')).toBe('sáb 07/11');
  });
});

describe('porcentajeBarra', () => {
  it('el día que más vendió llena la barra', () => {
    expect(porcentajeBarra(1245300, 1245300)).toBe(100);
    expect(porcentajeBarra(622650, 1245300)).toBe(50);
  });
  it('sin ventas o sin máximo queda vacía', () => {
    expect(porcentajeBarra(0, 1000)).toBe(0);
    expect(porcentajeBarra(500, 0)).toBe(0);
  });
});

describe('maximoDelPeriodo / diaSinVentas', () => {
  it('toma el mayor total y reconoce los días sin ventas', () => {
    const dias = [dia('2026-11-09', 0), dia('2026-11-08', 318200, 62), dia('2026-11-06', 1245300, 216)];
    expect(maximoDelPeriodo(dias)).toBe(1245300);
    expect(maximoDelPeriodo([])).toBe(0);
    expect(diaSinVentas(dias[0])).toBe(true);
    expect(diaSinVentas(dias[1])).toBe(false);
  });
});
