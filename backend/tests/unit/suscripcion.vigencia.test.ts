import { describe, it, expect } from 'vitest';
import {
  hoyEnTz, aFechaUtc, deFechaUtc, cubreFecha, sumarUnMes, diaSiguiente, inicioRenovacion, estadoVista,
} from '../../src/services/suscripcion.vigencia.js';

const TZ = 'America/Argentina/Buenos_Aires';
const susc = (inicio: string, vencimiento: string) => ({ inicio: aFechaUtc(inicio), vencimiento: aFechaUtc(vencimiento) });

describe('hoyEnTz', () => {
  it('usa el dia del negocio, no el de UTC', () => {
    // 2026-08-11T02:00Z son las 23:00 del 10/08 en Buenos Aires (UTC-3)
    expect(hoyEnTz(TZ, new Date('2026-08-11T02:00:00.000Z'))).toBe('2026-08-10');
  });
});

describe('cubreFecha', () => {
  const s = susc('2026-08-01', '2026-08-31');
  it('el dia anterior al inicio no esta cubierto', () => expect(cubreFecha(s, '2026-07-31')).toBe(false));
  it('el primer dia esta cubierto', () => expect(cubreFecha(s, '2026-08-01')).toBe(true));
  it('un dia intermedio esta cubierto', () => expect(cubreFecha(s, '2026-08-15')).toBe(true));
  it('el ultimo dia esta cubierto (vencimiento INCLUSIVE)', () => expect(cubreFecha(s, '2026-08-31')).toBe(true));
  it('el dia posterior al vencimiento no esta cubierto', () => expect(cubreFecha(s, '2026-09-01')).toBe(false));
});

describe('sumarUnMes', () => {
  it('caso simple', () => expect(sumarUnMes('2026-08-01')).toBe('2026-09-01'));
  it('cruza de anio', () => expect(sumarUnMes('2026-12-15')).toBe('2027-01-15'));
  it('recorta al ultimo dia del mes destino', () => expect(sumarUnMes('2026-01-31')).toBe('2026-02-28'));
  it('respeta el anio bisiesto', () => expect(sumarUnMes('2028-01-31')).toBe('2028-02-29'));
});

describe('diaSiguiente', () => {
  it('caso simple', () => expect(diaSiguiente('2026-08-30')).toBe('2026-08-31'));
  it('cruza de mes', () => expect(diaSiguiente('2026-08-31')).toBe('2026-09-01'));
  it('cruza de anio', () => expect(diaSiguiente('2026-12-31')).toBe('2027-01-01'));
});

describe('inicioRenovacion', () => {
  it('renovacion anticipada: arranca el dia siguiente al vencimiento, no pierde dias', () => {
    expect(inicioRenovacion('2026-08-31', '2026-08-20')).toBe('2026-09-01');
  });
  it('renovacion el mismo dia del vencimiento: arranca al dia siguiente', () => {
    expect(inicioRenovacion('2026-08-31', '2026-08-31')).toBe('2026-09-01');
  });
  it('renovacion tardia: arranca hoy, no regala dias retroactivos', () => {
    expect(inicioRenovacion('2026-08-31', '2026-09-15')).toBe('2026-09-15');
  });
});

describe('estadoVista', () => {
  it('cancelada gana sobre todo', () => {
    expect(estadoVista({ estado: 'CANCELADA', vencimiento: aFechaUtc('2026-12-31') }, '2026-08-10')).toBe('CANCELADA');
  });
  it('activa con vencimiento futuro', () => {
    expect(estadoVista({ estado: 'ACTIVA', vencimiento: aFechaUtc('2026-08-31') }, '2026-08-10')).toBe('ACTIVA');
  });
  it('activa el mismo dia del vencimiento sigue ACTIVA', () => {
    expect(estadoVista({ estado: 'ACTIVA', vencimiento: aFechaUtc('2026-08-31') }, '2026-08-31')).toBe('ACTIVA');
  });
  it('activa con vencimiento pasado se ve VENCIDA', () => {
    expect(estadoVista({ estado: 'ACTIVA', vencimiento: aFechaUtc('2026-08-31') }, '2026-09-01')).toBe('VENCIDA');
  });
});

describe('aFechaUtc / deFechaUtc', () => {
  it('ida y vuelta', () => expect(deFechaUtc(aFechaUtc('2026-08-15'))).toBe('2026-08-15'));
});
