import { describe, it, expect } from 'vitest';
import { diaYHora, textoMeses } from './dashboard-academia';

describe('diaYHora', () => {
  it('escribe el día y el horario', () => {
    expect(diaYHora({ diaSemana: 2, horaInicio: '17:00', horaFin: '18:00' })).toBe('Martes 17:00–18:00');
    expect(diaYHora({ diaSemana: 0, horaInicio: '09:00', horaFin: '10:30' })).toBe('Domingo 09:00–10:30');
  });
  it('sin día muestra solo el horario', () => {
    expect(diaYHora({ diaSemana: null, horaInicio: '17:00', horaFin: '18:00' })).toBe('17:00–18:00');
  });
});

describe('textoMeses', () => {
  it('singular y plural', () => {
    expect(textoMeses(1)).toBe('1 mes');
    expect(textoMeses(3)).toBe('3 meses');
  });
});
