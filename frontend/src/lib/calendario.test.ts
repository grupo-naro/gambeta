import { describe, it, expect } from 'vitest';
import { semanaDe, colorDeCancha, PALETA, ubicarEnTz, nombreCancha, hhmmDeMinutos, horasQueToca, horasDelDia } from './calendario';
import type { TurnoFijo, Bloqueo } from './types';

const dow = (ymd: string) => new Date(ymd + 'T12:00:00Z').getUTCDay(); // 1 = lunes

describe('semanaDe', () => {
  it('devuelve 7 días empezando en lunes y conteniendo el ancla', () => {
    const { dias, lunes, domingo } = semanaDe('2026-06-13'); // sábado
    expect(dias).toHaveLength(7);
    expect(dow(dias[0])).toBe(1); // lunes
    expect(dow(dias[6])).toBe(0); // domingo
    expect(lunes).toBe(dias[0]);
    expect(domingo).toBe(dias[6]);
    expect(lunes <= '2026-06-13' && '2026-06-13' <= domingo).toBe(true);
  });
  it('un lunes se devuelve a sí mismo como inicio', () => {
    const { dias } = semanaDe('2026-06-08'); // lunes
    expect(dias[0]).toBe('2026-06-08');
  });
});

describe('colorDeCancha', () => {
  const canchas = [{ id: 'b' }, { id: 'a' }, { id: 'c' }]; // se ordena por id adentro
  it('es determinístico: misma cancha, mismo color', () => {
    expect(colorDeCancha('a', canchas)).toEqual(colorDeCancha('a', canchas));
  });
  it('asigna colores distintos por orden de id', () => {
    const ord = [...canchas].sort((x, y) => x.id.localeCompare(y.id)); // a,b,c
    expect(colorDeCancha('a', canchas)).toEqual(PALETA[0]);
    expect(colorDeCancha('b', canchas)).toEqual(PALETA[1]);
    expect(colorDeCancha('c', canchas)).toEqual(PALETA[2]);
    expect(ord[0].id).toBe('a');
  });
  it('id desconocido cae en el primer color', () => {
    expect(colorDeCancha('zzz', canchas)).toEqual(PALETA[0]);
  });
});

describe('nombreCancha', () => {
  it('prefija "Cancha" a nombres numericos', () => {
    expect(nombreCancha('2')).toBe('Cancha 2');
    expect(nombreCancha('10')).toBe('Cancha 10');
  });
  it('prefija a nombres con barra (divisibles)', () => {
    expect(nombreCancha('4/1')).toBe('Cancha 4/1');
  });
  it('deja los nombres propios tal cual', () => {
    expect(nombreCancha('TECHADA')).toBe('TECHADA');
  });
  it('vacio/undefined -> "Cancha"', () => {
    expect(nombreCancha('')).toBe('Cancha');
    expect(nombreCancha(undefined)).toBe('Cancha');
  });
});

describe('ubicarEnTz', () => {
  it('ubica una fecha UTC en el día y hora de Argentina (UTC-3), sin corrimiento de jornada', () => {
    // 2026-06-16T22:00:00Z = 19:00 ART del 16, muy por encima de la apertura: mismo día calendario.
    const r = ubicarEnTz('2026-06-16T22:00:00.000Z', '07:00');
    expect(r.fecha).toBe('2026-06-16');
    expect(r.horaNum).toBe(19);
  });

  it('regresión: un horario normal (17:00 ART) no se corre de día', () => {
    // 2026-06-16T20:00:00Z = 17:00 ART del 16.
    const r = ubicarEnTz('2026-06-16T20:00:00.000Z', '07:00');
    expect(r.fecha).toBe('2026-06-16');
    expect(r.horaNum).toBe(17);
  });

  it('una reserva de las 00:00 (guardada con el instante del día siguiente) vuelve a la jornada del día anterior', () => {
    // 2026-09-14T03:00:00Z = 2026-09-14 00:00 ART. Con apertura 07:00, esa medianoche
    // pertenece a la jornada del 13, no al día calendario 14 en el que cae el instante.
    const r = ubicarEnTz('2026-09-14T03:00:00.000Z', '07:00');
    expect(r.fecha).toBe('2026-09-13');
    expect(r.horaNum).toBe(0);
  });

  it('borde: la hora exacta de apertura no se corre de día', () => {
    // 2026-09-14T04:00:00Z = 01:00 ART del 14. Apertura 01:00 => no hay corrimiento.
    const r = ubicarEnTz('2026-09-14T04:00:00.000Z', '01:00');
    expect(r.fecha).toBe('2026-09-14');
    expect(r.horaNum).toBe(1);
  });

  it('borde: un minuto antes de la apertura sí se corre al día anterior', () => {
    // 2026-09-14T09:59:00Z = 06:59 ART del 14. Apertura 07:00 => pertenece a la jornada del 13.
    const r = ubicarEnTz('2026-09-14T09:59:00.000Z', '07:00');
    expect(r.fecha).toBe('2026-09-13');
    expect(r.horaNum).toBe(6);
  });
});

import { materializar, etiquetaMotivo } from './calendario';

describe('etiquetaMotivo', () => {
  it('mapea los motivos a etiquetas cortas', () => {
    expect(etiquetaMotivo('TORNEO')).toBe('Torneo');
    expect(etiquetaMotivo('ENTRENAMIENTO')).toBe('Entren.');
    expect(etiquetaMotivo('MANTENIMIENTO')).toBe('Mantenim.');
    expect(etiquetaMotivo('OTRO')).toBe('Otro');
  });
});

describe('materializar', () => {
  const { dias } = semanaDe('2026-06-08'); // lunes..domingo
  const diaCon = (wd: number) => dias.find((d) => new Date(d + 'T12:00:00Z').getUTCDay() === wd)!;
  const fijoBase: TurnoFijo = { id: 'f1', canchaId: 'c1', clienteNombre: 'Juan', whatsapp: null, horaInicio: '18:00', horaFin: '20:00', precio: 1000, activo: true, diaSemana: 0, cancha: { nombre: 'C1' } };

  it('un fijo aparece en su weekday y se expande a las horas cubiertas (18-20 → 18 y 19)', () => {
    const wed = diaCon(3);
    const ev = materializar(dias, [{ ...fijoBase, diaSemana: 3 }], []);
    const delDia = ev.filter((e) => e.fecha === wed);
    expect(delDia).toHaveLength(2);
    expect(delDia.map((e) => e.horaNum).sort((a, b) => a - b)).toEqual([18, 19]);
    expect(delDia[0].tipo).toBe('fijo');
    expect(delDia[0].subtitulo).toBe('Juan');
    expect(delDia[0].canchaId).toBe('c1');
  });

  it('una excepción en esa fecha excluye el fijo', () => {
    const wed = diaCon(3);
    const ev = materializar(dias, [{ ...fijoBase, diaSemana: 3, excepciones: [{ id: 'x', fecha: wed }] }], []);
    expect(ev.filter((e) => e.fecha === wed)).toHaveLength(0);
  });

  it('una excepción con fecha ISO completa (como la manda la API) igual excluye el fijo', () => {
    const wed = diaCon(3);
    const ev = materializar(dias, [{ ...fijoBase, diaSemana: 3, excepciones: [{ id: 'x', fecha: wed + 'T00:00:00.000Z' }] }], []);
    expect(ev.filter((e) => e.fecha === wed)).toHaveLength(0);
  });

  it('un fijo inactivo se excluye', () => {
    const ev = materializar(dias, [{ ...fijoBase, diaSemana: 3, activo: false }], []);
    expect(ev).toHaveLength(0);
  });

  // El período ("Desde / Hasta") corta el fijo: el calendario lo expande acá en el navegador, así
  // que tiene que respetarlo igual que el backend (si no, "hoy" lo oculta y el calendario no).
  it('pasado el "hasta" el fijo ya no se dibuja, pero el último día (inclusive) sí', () => {
    const wed = diaCon(3); // 2026-06-10
    const fijo = { ...fijoBase, diaSemana: 3, vigenciaHasta: wed };
    expect(materializar(dias, [fijo], []).filter((e) => e.fecha === wed)).toHaveLength(2);
    const semanaSiguiente = semanaDe('2026-06-15').dias;
    expect(materializar(semanaSiguiente, [fijo], [])).toHaveLength(0);
  });

  it('antes del "desde" el fijo todavía no se dibuja', () => {
    const wed = diaCon(3);
    const fijo = { ...fijoBase, diaSemana: 3, vigenciaDesde: '2026-06-17' };
    expect(materializar(dias, [fijo], [])).toHaveLength(0);
    expect(materializar(semanaDe('2026-06-15').dias, [{ ...fijo, vigenciaDesde: wed }], [])).toHaveLength(2);
  });

  it('un fijo con período null (sin abono) se dibuja siempre', () => {
    const ev = materializar(dias, [{ ...fijoBase, diaSemana: 3, vigenciaDesde: null, vigenciaHasta: null }], []);
    expect(ev).toHaveLength(2);
  });

  it('un bloqueo recurrente con período solo se dibuja dentro de él (hasta inclusive)', () => {
    const wed = diaCon(3);
    const b = { id: 'b9', canchaId: 'c1', motivo: 'TORNEO' as const, recurrente: true, diaSemana: 3, fecha: null, horaInicio: '20:00', horaFin: '21:00', nota: null, cancha: { nombre: 'C1' }, vigenciaHasta: wed };
    expect(materializar(dias, [], [b]).filter((e) => e.fecha === wed)).toHaveLength(1);
    expect(materializar(semanaDe('2026-06-15').dias, [], [b])).toHaveLength(0);
    expect(materializar(dias, [], [{ ...b, vigenciaDesde: '2026-06-17', vigenciaHasta: null }])).toHaveLength(0);
  });

  it('un bloqueo puntual aparece sólo en su fecha', () => {
    const mar = diaCon(2);
    const b: Bloqueo = { id: 'b1', canchaId: 'c1', motivo: 'TORNEO', recurrente: false, diaSemana: null, fecha: mar, horaInicio: '19:00', horaFin: '21:00', nota: null, cancha: { nombre: 'C1' } };
    const ev = materializar(dias, [], [b]);
    expect(ev).toHaveLength(2);
    expect(ev.every((e) => e.fecha === mar)).toBe(true);
    expect(ev[0].tipo).toBe('bloqueo');
    expect(ev[0].motivo).toBe('TORNEO');
    expect(ev[0].subtitulo).toBe('Torneo');
  });

  it('un bloqueo puntual con fecha ISO completa (como la manda la API) aparece en su fecha', () => {
    const mar = diaCon(2);
    const b: Bloqueo = { id: 'b1', canchaId: 'c1', motivo: 'TORNEO', recurrente: false, diaSemana: null, fecha: mar + 'T00:00:00.000Z', horaInicio: '19:00', horaFin: '21:00', nota: null, cancha: { nombre: 'C1' } };
    const ev = materializar(dias, [], [b]);
    expect(ev).toHaveLength(2);
    expect(ev.every((e) => e.fecha === mar)).toBe(true);
  });

  it('un bloqueo recurrente aparece por diaSemana', () => {
    const vie = diaCon(5);
    const b: Bloqueo = { id: 'b2', canchaId: 'c1', motivo: 'MANTENIMIENTO', recurrente: true, diaSemana: 5, fecha: null, horaInicio: '16:00', horaFin: '17:00', nota: 'pintura', cancha: { nombre: 'C1' } };
    const ev = materializar(dias, [], [b]);
    expect(ev).toHaveLength(1);
    expect(ev[0].fecha).toBe(vie);
    expect(ev[0].subtitulo).toBe('Mantenim. · pintura');
  });
});

describe('ubicarEnTz con minutos', () => {
  it('devuelve el minuto real, no solo la hora', () => {
    // 2026-06-10T21:30:00Z = 18:30 en Argentina (UTC-3)
    const r = ubicarEnTz('2026-06-10T21:30:00.000Z', '07:00');
    expect(r.fecha).toBe('2026-06-10');
    expect(r.horaNum).toBe(18);
    expect(r.minuto).toBe(30);
  });
  it('una hora en punto tiene minuto 0', () => {
    expect(ubicarEnTz('2026-06-10T21:00:00.000Z', '07:00').minuto).toBe(0);
  });
});

describe('hhmmDeMinutos', () => {
  it('formatea minutos desde medianoche', () => {
    expect(hhmmDeMinutos(0)).toBe('00:00');
    expect(hhmmDeMinutos(1110)).toBe('18:30');
    expect(hhmmDeMinutos(1200)).toBe('20:00');
  });
});

describe('materializar con duración', () => {
  const cancha = { id: 'c1', nombre: '1' };
  const fijo2h: TurnoFijo = {
    id: 'f1', canchaId: 'c1', cancha, clienteNombre: 'Ana', whatsapp: null, precio: 1000, activo: true,
    diaSemana: 3, horaInicio: '18:00', horaFin: '20:00', excepciones: [],
  };

  it('un fijo de 2 horas expande a dos celdas, la segunda marcada como continuación', () => {
    const evs = materializar(['2026-06-10'], [fijo2h], []);
    expect(evs.map((e) => e.horaNum)).toEqual([18, 19]);
    expect(evs.map((e) => e.esContinuacion)).toEqual([false, true]);
    // Las dos celdas informan el mismo turno: arranca 18:00, termina 20:00, dura 120 minutos.
    expect(evs.every((e) => e.horaTexto === '18:00' && e.finTexto === '20:00' && e.duracionMin === 120)).toBe(true);
  });

  it('un fijo que arranca a las 18:30 conserva el minuto y cae en la celda de las 18', () => {
    const fijoMedia = { ...fijo2h, horaInicio: '18:30', horaFin: '20:00' };
    const evs = materializar(['2026-06-10'], [fijoMedia], []);
    expect(evs.map((e) => e.horaNum)).toEqual([18, 19]);
    expect(evs[0].horaTexto).toBe('18:30');
    expect(evs[0].finTexto).toBe('20:00');
    expect(evs[0].duracionMin).toBe(90);
  });
});

describe('horasQueToca', () => {
  it('18:00-20:00 -> [18, 19]', () => {
    expect(horasQueToca(18 * 60, 20 * 60)).toEqual([18, 19]);
  });
  it('18:30-20:00 -> [18, 19]', () => {
    expect(horasQueToca(18 * 60 + 30, 20 * 60)).toEqual([18, 19]);
  });
  it('18:00-19:00 -> [18]', () => {
    expect(horasQueToca(18 * 60, 19 * 60)).toEqual([18]);
  });
  it('18:30-19:00 -> [18]', () => {
    expect(horasQueToca(18 * 60 + 30, 19 * 60)).toEqual([18]);
  });
});

describe('horasDelDia con jornada que cruza medianoche', () => {
  it('con cierre 01:00 llega hasta las 00:00', () => {
    const horas = horasDelDia('07:00', '01:00');
    expect(horas[horas.length - 1]).toBe('00:00');
    expect(horas).not.toContain('01:00');
  });

  it('regresión: con cierre 23:00 no cambia', () => {
    expect(horasDelDia('16:00', '23:00')).toEqual(['16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00']);
  });
});

// Hallazgo 4 de la revisión final del plan de jornada del complejo: el heatmap de ocupación
// del dashboard (ocupacion-heatmap.tsx) reimplementaba a mano el cálculo de horas con
// `Number(horaCierre.slice(0,2))`, que con apertura 07:00/cierre 01:00 da un rango [7, 1) vacío
// (0 iteraciones) — el heatmap se renderizaba en blanco. horasDelDia ya resuelve esto
// correctamente; el componente ahora la usa en vez de reimplementar el cálculo.
describe('horasDelDia (consumida por el heatmap de ocupación)', () => {
  it('con apertura 07:00/cierre 01:00 da 18 horas, de 07:00 a 00:00, sin quedar vacío', () => {
    const horas = horasDelDia('07:00', '01:00');
    expect(horas).toEqual([
      '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00',
      '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '00:00',
    ]);
    expect(horas).toHaveLength(18);
  });

  it('regresión: con apertura 09:00/cierre 23:00 sigue dando 14 horas (09..22)', () => {
    const horas = horasDelDia('09:00', '23:00');
    expect(horas).toHaveLength(14);
    expect(horas[0]).toBe('09:00');
    expect(horas[horas.length - 1]).toBe('22:00');
  });
});

// Hallazgo 2 de la revisión final del plan de jornada del complejo: horasQueToca razonaba en
// minutos de día calendario y perdía lo que cruza la medianoche (celda "24" inexistente, o
// rango [ini,fin) vacío cuando fin, calculado con aMin crudo, quedaba antes que ini).
describe('horasQueToca cruzando medianoche', () => {
  it('23:30-01:00 (90 min) -> [23, 0], no [23, 24]', () => {
    // Como lo arma calendario-semana.tsx para una reserva: iniMin de tiempo-de-día + duración.
    expect(horasQueToca(23 * 60 + 30, 23 * 60 + 30 + 90)).toEqual([23, 0]);
  });

  it('regresión: un rango que no cruza medianoche sigue igual (18:00-19:00 -> [18])', () => {
    expect(horasQueToca(18 * 60, 19 * 60)).toEqual([18]);
  });
});

describe('materializar cruzando medianoche (apertura pasada explícitamente)', () => {
  const cancha = { id: 'c1', nombre: '1' };
  const APERTURA = '07:00';

  it('un fijo 23:00-00:00 se dibuja en la celda [23], no desaparece', () => {
    const fijo: TurnoFijo = {
      id: 'f1', canchaId: 'c1', cancha, clienteNombre: 'Ana', whatsapp: null, precio: 1000, activo: true,
      diaSemana: 3, horaInicio: '23:00', horaFin: '00:00', excepciones: [],
    };
    const evs = materializar(['2026-06-10'], [fijo], [], undefined, APERTURA);
    expect(evs.map((e) => e.horaNum)).toEqual([23]);
  });

  it('un bloqueo 22:00-00:00 se dibuja en las celdas [22, 23], no desaparece', () => {
    const b: Bloqueo = { id: 'b1', canchaId: 'c1', motivo: 'MANTENIMIENTO', recurrente: false, diaSemana: null, fecha: '2026-06-10', horaInicio: '22:00', horaFin: '00:00', nota: null, cancha };
    const evs = materializar(['2026-06-10'], [], [b], undefined, APERTURA);
    expect(evs.map((e) => e.horaNum)).toEqual([22, 23]);
  });

  it('regresión: un fijo normal (18:00-19:00) sigue igual con apertura explícita', () => {
    const fijo: TurnoFijo = {
      id: 'f1', canchaId: 'c1', cancha, clienteNombre: 'Ana', whatsapp: null, precio: 1000, activo: true,
      diaSemana: 3, horaInicio: '18:00', horaFin: '19:00', excepciones: [],
    };
    const evs = materializar(['2026-06-10'], [fijo], [], undefined, APERTURA);
    expect(evs.map((e) => e.horaNum)).toEqual([18]);
  });
});
