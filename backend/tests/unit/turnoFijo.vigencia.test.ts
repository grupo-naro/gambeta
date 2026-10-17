import { describe, it, expect } from 'vitest';
import { fijoVigenteEn, periodosSeSolapan } from '../../src/services/turnoFijo.vigencia.js';

const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe('fijoVigenteEn', () => {
  it('sin período, vale siempre', () => {
    expect(fijoVigenteEn({ vigenciaDesde: null, vigenciaHasta: null }, '2030-01-01')).toBe(true);
  });

  it('el "hasta" es inclusive: el último día todavía figura, el siguiente ya no', () => {
    const f = { vigenciaDesde: d('2026-10-17'), vigenciaHasta: d('2026-10-31') };
    expect(fijoVigenteEn(f, '2026-10-31')).toBe(true);
    expect(fijoVigenteEn(f, '2026-11-03')).toBe(false);
  });

  it('antes del "desde" todavía no vale, y el "desde" es inclusive', () => {
    const f = { vigenciaDesde: d('2026-11-01'), vigenciaHasta: null };
    expect(fijoVigenteEn(f, '2026-10-31')).toBe(false);
    expect(fijoVigenteEn(f, '2026-11-01')).toBe(true);
    expect(fijoVigenteEn(f, '2027-06-01')).toBe(true);
  });

  it('con solo "hasta" (sin "desde") vale desde siempre hasta esa fecha', () => {
    const f = { vigenciaDesde: null, vigenciaHasta: d('2026-10-31') };
    expect(fijoVigenteEn(f, '2020-01-01')).toBe(true);
    expect(fijoVigenteEn(f, '2026-11-01')).toBe(false);
  });
});

describe('periodosSeSolapan', () => {
  it('períodos consecutivos (31/10 y 01/11) no se solapan: es la renovación', () => {
    expect(periodosSeSolapan({ desde: '2026-10-01', hasta: '2026-10-31' }, { desde: '2026-11-01', hasta: '2026-11-30' })).toBe(false);
  });

  it('compartir un día alcanza para solaparse', () => {
    expect(periodosSeSolapan({ desde: '2026-10-01', hasta: '2026-10-31' }, { desde: '2026-10-31', hasta: '2026-11-30' })).toBe(true);
  });

  it('un período sin fin se solapa con cualquiera que termine después de su inicio', () => {
    expect(periodosSeSolapan({ desde: '2026-10-01', hasta: null }, { desde: '2027-01-01', hasta: '2027-01-31' })).toBe(true);
    expect(periodosSeSolapan({ desde: '2026-10-01', hasta: '2026-10-31' }, { desde: '2026-11-01', hasta: null })).toBe(false);
  });

  it('sin "desde" el período empieza en el pasado infinito', () => {
    expect(periodosSeSolapan({ desde: null, hasta: '2026-10-31' }, { desde: '2020-01-01', hasta: '2020-12-31' })).toBe(true);
  });
});
