import { describe, it, expect } from 'vitest';
import { updateConfigSchema } from '../../src/validators/config.schema.js';
import { cierreDeJornada } from '../../src/utils/tz.js';

const base = { query: {}, params: {} };
const parsear = (body: Record<string, unknown>) => updateConfigSchema.safeParse({ ...base, body });

describe('cierreDeJornada', () => {
  // Los 4 casos que la Tarea 8 dejó pasar por error: un cierre invertido o inválido, comparado
  // contra una apertura posterior, se leía como si cruzara a la madrugada del día siguiente.
  it('no cruza la medianoche cuando el "cierre" cae después de las 06:00 (dato invertido)', () => {
    // apertura 23:00, cierre 09:00: 09:00 no es madrugada temprana → no cruza → 540 >= 1380 es falso,
    // así que sigue siendo "cierre" (540) < "apertura" (1380): la comparación en el schema lo rechaza.
    expect(cierreDeJornada('09:00', '23:00')).toBe(540);
    // apertura 16:00 (default), cierre 10:00: 600 no es madrugada temprana → no cruza.
    expect(cierreDeJornada('10:00', '16:00')).toBe(600);
    // apertura 22:00, cierre 20:00: 1200 no es madrugada temprana → no cruza.
    expect(cierreDeJornada('20:00', '22:00')).toBe(1200);
    // pico/finde: apertura 20:00, cierre 18:00: 1080 no es madrugada temprana → no cruza.
    expect(cierreDeJornada('18:00', '20:00')).toBe(1080);
  });

  it('sí cruza la medianoche cuando el cierre cae temprano en la madrugada (antes de las 06:00)', () => {
    // apertura 07:00, cierre 01:00: 60 < 360 → cruza → 60 + 1440 = 1500.
    expect(cierreDeJornada('01:00', '07:00')).toBe(1500);
    // cierre 00:00 con cualquier apertura: 0 < 360 → cruza siempre.
    expect(cierreDeJornada('00:00', '07:00')).toBe(1440);
    expect(cierreDeJornada('00:00', '16:00')).toBe(1440);
    // cierre 23:00: nunca es menor que la apertura (07:00 o 16:00) → nunca cruza, sin cambios.
    expect(cierreDeJornada('23:00', '07:00')).toBe(1380);
    expect(cierreDeJornada('23:00', '16:00')).toBe(1380);
  });
});

describe('cierre posterior a la medianoche', () => {
  it('acepta abrir 07:00 y cerrar 01:00', () => {
    expect(parsear({ horaApertura: '07:00', horaCierre: '01:00' }).success).toBe(true);
    expect(parsear({ horaAperturaFinde: '07:00', horaCierreFinde: '02:00' }).success).toBe(true);
  });

  it('sigue aceptando los cierres de hoy', () => {
    expect(parsear({ horaApertura: '07:00', horaCierre: '23:00' }).success).toBe(true);
    expect(parsear({ horaApertura: '07:00', horaCierre: '00:00' }).success).toBe(true);
  });

  it('rechaza una jornada de duración cero', () => {
    expect(parsear({ horaApertura: '07:00', horaCierre: '07:00' }).success).toBe(false);
  });

  it('acepta el pico corriendo hasta un cierre de madrugada', () => {
    expect(parsear({ horaApertura: '07:00', picoDesde: '20:00', picoHasta: '01:00' }).success).toBe(true);
  });
});
