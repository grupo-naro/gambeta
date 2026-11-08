import { describe, it, expect } from 'vitest';
import { cambiosDeEdicion, duracionesPosibles, etiquetaDuracion, minutosDeReserva } from './editar-reserva';

const antes = { duracionMin: 60, monto: 20000, notas: '' };

describe('minutosDeReserva', () => {
  it('calcula la duración entre inicio y fin', () => {
    expect(minutosDeReserva('2026-06-12T23:00:00.000Z', '2026-06-13T00:30:00.000Z')).toBe(90);
  });
});

describe('duracionesPosibles', () => {
  it('ofrece de 30 min a 4 h de a 30', () => {
    expect(duracionesPosibles(60)).toEqual([30, 60, 90, 120, 150, 180, 210, 240]);
  });
  it('incluye la actual aunque no sea múltiplo de 30', () => {
    expect(duracionesPosibles(75)).toContain(75);
  });
});

describe('etiquetaDuracion', () => {
  it('las escribe como se hablan', () => {
    expect(etiquetaDuracion(30)).toBe('30 min');
    expect(etiquetaDuracion(60)).toBe('1 h');
    expect(etiquetaDuracion(90)).toBe('1½ h');
    expect(etiquetaDuracion(150)).toBe('2½ h');
  });
});

describe('cambiosDeEdicion', () => {
  it('manda solo lo que cambió (el caso de ayer: de 1 h a 1½ h y su precio)', () => {
    const r = cambiosDeEdicion(antes, { duracionMin: 90, monto: 30000, notas: '' });
    expect(r).toEqual({ ok: true, cambios: { duracionMin: 90, monto: 30000 } });
  });
  it('solo la nota', () => {
    expect(cambiosDeEdicion(antes, { ...antes, notas: ' Clase de pádel ' })).toEqual({ ok: true, cambios: { notas: 'Clase de pádel' } });
  });
  it('sin cambios avisa', () => {
    expect(cambiosDeEdicion(antes, antes)).toEqual({ ok: false, error: 'No cambiaste nada' });
  });
  it('un monto inválido o negativo se rechaza', () => {
    expect(cambiosDeEdicion(antes, { ...antes, monto: NaN }).ok).toBe(false);
    expect(cambiosDeEdicion(antes, { ...antes, monto: -5 }).ok).toBe(false);
  });
  it('sacar la nota la manda vacía (el backend la borra)', () => {
    expect(cambiosDeEdicion({ ...antes, notas: 'x' }, { ...antes, notas: '' })).toEqual({ ok: true, cambios: { notas: '' } });
  });
});
