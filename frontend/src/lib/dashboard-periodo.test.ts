import { describe, it, expect } from 'vitest';
import { resolverPeriodo } from './dashboard-periodo';

const HOY = '2026-11-11'; // miércoles

describe('resolverPeriodo', () => {
  it('sin período: los últimos 30 días hasta hoy', () => {
    expect(resolverPeriodo({}, HOY)).toMatchObject({ periodo: '30', desde: '2026-10-13', hasta: HOY, etiqueta: 'Últimos 30 días' });
  });

  it('los períodos de siempre', () => {
    expect(resolverPeriodo({ periodo: 'hoy' }, HOY)).toMatchObject({ desde: HOY, hasta: HOY, etiqueta: 'Hoy' });
    expect(resolverPeriodo({ periodo: '7' }, HOY)).toMatchObject({ desde: '2026-11-05', hasta: HOY });
    expect(resolverPeriodo({ periodo: 'semana' }, HOY)).toMatchObject({ desde: '2026-11-09', hasta: HOY }); // lunes
    expect(resolverPeriodo({ periodo: 'mes' }, HOY)).toMatchObject({ desde: '2026-11-01', hasta: HOY });
  });

  it('un día puntual: desde y hasta son ese día', () => {
    const p = resolverPeriodo({ periodo: 'fecha', desde: '2026-11-04' }, HOY);
    expect(p).toMatchObject({ periodo: 'fecha', desde: '2026-11-04', hasta: '2026-11-04' });
    expect(p.etiqueta).toBe('Miércoles, 4 de noviembre');
  });

  it('un rango entre dos fechas', () => {
    const p = resolverPeriodo({ periodo: 'fecha', desde: '2026-11-02', hasta: '2026-11-06' }, HOY);
    expect(p).toMatchObject({ desde: '2026-11-02', hasta: '2026-11-06', etiqueta: '02/11/2026 al 06/11/2026' });
  });

  it('si vienen al revés, las ordena', () => {
    expect(resolverPeriodo({ periodo: 'fecha', desde: '2026-11-06', hasta: '2026-11-02' }, HOY))
      .toMatchObject({ desde: '2026-11-02', hasta: '2026-11-06' });
  });

  it('no mira el futuro: lo que pasa de hoy se recorta a hoy', () => {
    expect(resolverPeriodo({ periodo: 'fecha', desde: '2026-11-08', hasta: '2026-11-20' }, HOY)).toMatchObject({ desde: '2026-11-08', hasta: HOY });
    expect(resolverPeriodo({ periodo: 'fecha', desde: '2026-11-20' }, HOY)).toMatchObject({ desde: HOY, hasta: HOY });
  });

  it('una fecha inválida cae en el período por defecto', () => {
    expect(resolverPeriodo({ periodo: 'fecha', desde: 'cualquiera' }, HOY)).toMatchObject({ periodo: '30', hasta: HOY });
    expect(resolverPeriodo({ periodo: 'fecha' }, HOY)).toMatchObject({ periodo: '30' });
  });

  it('un rango larguísimo se limita a un año', () => {
    expect(resolverPeriodo({ periodo: 'fecha', desde: '2020-01-01', hasta: HOY }, HOY).desde).toBe('2025-11-11');
  });
});
