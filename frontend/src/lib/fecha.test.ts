import { describe, it, expect } from 'vitest';
import { hoyAR, parseFiltros, fmtHora, addDias, esHoy, fmtFechaLarga } from '@/lib/fecha';

describe('hoyAR', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(hoyAR()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('parseFiltros', () => {
  it('defaults fecha to today and leaves cancha/estado empty', () => {
    const f = parseFiltros({});
    expect(f.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(f.canchaId).toBe('');
    expect(f.estado).toBe('');
  });
  it('reads provided values', () => {
    const f = parseFiltros({ fecha: '2026-06-13', canchaId: 'c1', estado: 'CONFIRMADA' });
    expect(f).toEqual({ fecha: '2026-06-13', canchaId: 'c1', estado: 'CONFIRMADA' });
  });
});

describe('helpers de agenda', () => {
  it('fmtHora devuelve HH:MM', () => {
    // 2026-06-15T21:30Z = 18:30 hora Argentina
    expect(fmtHora('2026-06-15T21:30:00.000Z')).toBe('18:30');
  });
  it('addDias suma/resta días sobre YYYY-MM-DD', () => {
    expect(addDias('2026-06-15', 1)).toBe('2026-06-16');
    expect(addDias('2026-06-01', -1)).toBe('2026-05-31');
  });
  it('esHoy compara contra hoy AR', () => {
    expect(esHoy(hoyAR())).toBe(true);
    expect(esHoy('2000-01-01')).toBe(false);
  });
  it('fmtFechaLarga arma "<día> <n> de <mes>"', () => {
    expect(fmtFechaLarga('2026-06-15')).toMatch(/de junio$/);
  });
});
