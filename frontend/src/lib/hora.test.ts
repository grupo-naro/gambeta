import { describe, it, expect } from 'vitest';
import { maskHora, normalizeHora, resolverAperturaCierreUnificados } from './hora';

describe('maskHora', () => {
  it('inserta el ":" solo al tipear 4 dígitos', () => {
    expect(maskHora('2130')).toBe('21:30');
    expect(maskHora('2100')).toBe('21:00');
    expect(maskHora('0930')).toBe('09:30');
  });
  it('no mete ":" hasta que haga falta', () => {
    expect(maskHora('')).toBe('');
    expect(maskHora('2')).toBe('2');
    expect(maskHora('21')).toBe('21');
  });
  it('3 dígitos: desambigua por hora válida', () => {
    expect(maskHora('213')).toBe('21:3');   // 21 es hora válida
    expect(maskHora('930')).toBe('9:30');    // 93 no es hora -> 9:30
  });
  it('descarta no-dígitos y es estable al re-tipear', () => {
    expect(maskHora('21:30')).toBe('21:30');
    expect(maskHora('21:3')).toBe('21:3');
    expect(maskHora('21hs')).toBe('21');
    expect(maskHora('213055')).toBe('21:30'); // recorta a 4
  });
});

describe('normalizeHora', () => {
  it('hora sola -> HH:00 (padea)', () => {
    expect(normalizeHora('21')).toBe('21:00');
    expect(normalizeHora('9')).toBe('09:00');
    expect(normalizeHora('0')).toBe('00:00');
    expect(normalizeHora('00')).toBe('00:00');
    expect(normalizeHora('23')).toBe('23:00');
  });
  it('hora:min -> HH:MM (padea ambos)', () => {
    expect(normalizeHora('21:30')).toBe('21:30');
    expect(normalizeHora('9:5')).toBe('09:05');
    expect(normalizeHora('09:00')).toBe('09:00');
  });
  it('dígitos pegados sin ":" -> HH:MM', () => {
    expect(normalizeHora('2130')).toBe('21:30');
    expect(normalizeHora('0930')).toBe('09:30');
    expect(normalizeHora('930')).toBe('09:30');
    expect(normalizeHora('213')).toBe('21:03');
  });
  it('recorta espacios', () => {
    expect(normalizeHora('  21  ')).toBe('21:00');
  });
  it('invalido -> null', () => {
    for (const v of ['24', '25', '9:60', '9:70', '', '   ', 'abc', '21:', ':30', '-1', '1:2:3', '21.30']) {
      expect(normalizeHora(v)).toBeNull();
    }
  });
});

// Hallazgo 3 de la revisión final del plan de jornada del complejo: calendario/page.tsx y
// dashboard/page.tsx resolvían cierreU comparando cierreMin crudo, que elige mal el cierre "más
// tardío" cuando semana y fin de semana cruzan la medianoche de forma distinta. sheetsData.ts
// (backend) ya usa minutoDeJornada para esto; esta función replica ese mismo criterio.
describe('resolverAperturaCierreUnificados', () => {
  it('con cierre semana 01:00 y finde 00:00, el cierre unificado es 01:00 (el más tardío en jornada)', () => {
    const { aperturaU, cierreU } = resolverAperturaCierreUnificados({
      horaApertura: '07:00', horaCierre: '01:00', horaAperturaFinde: '07:00', horaCierreFinde: '00:00',
    });
    expect(aperturaU).toBe('07:00');
    expect(cierreU).toBe('01:00');
  });

  it('al revés (semana 00:00, finde 01:00) también elige el más tardío', () => {
    const { cierreU } = resolverAperturaCierreUnificados({
      horaApertura: '07:00', horaCierre: '00:00', horaAperturaFinde: '07:00', horaCierreFinde: '01:00',
    });
    expect(cierreU).toBe('01:00');
  });

  it('regresión: sin cruce de medianoche, elige el cierre con el minuto más alto', () => {
    const { aperturaU, cierreU } = resolverAperturaCierreUnificados({
      horaApertura: '16:00', horaCierre: '23:00', horaAperturaFinde: '09:00', horaCierreFinde: '22:00',
    });
    expect(aperturaU).toBe('09:00');
    expect(cierreU).toBe('23:00');
  });
});
