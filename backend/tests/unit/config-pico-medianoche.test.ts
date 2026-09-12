import { describe, it, expect } from 'vitest';
import { updateConfigSchema } from '../../src/validators/config.schema.js';
import { crearTurnoFijoSchema } from '../../src/validators/turnoFijo.schema.js';
import { crearBloqueoSchema } from '../../src/validators/bloqueo.schema.js';

/**
 * `precioDeRango` usa `cierreMin()`, así que YA entiende una franja pico que termina a
 * medianoche: "00:00" vale 1440. Los validadores, en cambio, comparaban las horas como texto
 * ("20:00" < "00:00" es falso) y rechazaban justo esa configuración — el complejo no podía
 * guardar el pico hasta el cierre aunque el cálculo lo soportara.
 */
const base = { query: {}, params: {} };
const parsear = (body: Record<string, unknown>) => updateConfigSchema.safeParse({ ...base, body });

describe('franja pico que termina a medianoche', () => {
  it('acepta el pico de semana hasta las 00:00', () => {
    expect(parsear({ picoDesde: '20:00', picoHasta: '00:00' }).success).toBe(true);
  });

  it('acepta el pico de finde hasta las 00:00', () => {
    expect(parsear({ picoFindeDesde: '18:00', picoFindeHasta: '00:00' }).success).toBe(true);
  });

  it('sigue rechazando una franja invertida de verdad', () => {
    expect(parsear({ picoDesde: '22:00', picoHasta: '18:00' }).success).toBe(false);
    expect(parsear({ picoFindeDesde: '22:00', picoFindeHasta: '18:00' }).success).toBe(false);
  });

  it('sigue rechazando una franja de ancho cero', () => {
    expect(parsear({ picoDesde: '20:00', picoHasta: '20:00' }).success).toBe(false);
  });

  it('"00:00" significa arranque del día como DESDE, y fin del día como HASTA', () => {
    // Asimetría deliberada, espejo exacto de lo que hace `precioDeRango`: el desde se lee con
    // `hhmmAMin` (00:00 => minuto 0) y el hasta con `cierreMin` (00:00 => minuto 1440). Por eso
    // una franja de 00:00 a 06:00 es válida (madrugada) y una de 20:00 a 00:00 también.
    expect(parsear({ picoDesde: '00:00', picoHasta: '06:00' }).success).toBe(true);
    expect(parsear({ picoDesde: '20:00', picoHasta: '00:00' }).success).toBe(true);
  });

  it('sigue aceptando una franja normal que no toca medianoche', () => {
    expect(parsear({ picoDesde: '18:00', picoHasta: '22:00' }).success).toBe(true);
  });
});

/**
 * Mismo defecto, otros dos validadores. `agenda.service.ts` y `turnoFijo.service.ts` ya usan
 * `cierreMin(horaFin)` —con comentarios que dicen explícitamente que es para el fijo que cierra
 * a medianoche— pero los schemas comparaban texto y no dejaban crearlo.
 */
describe('turnos fijos y bloqueos que terminan a medianoche', () => {
  const fijo = (horaInicio: string, horaFin: string) =>
    crearTurnoFijoSchema.safeParse({
      ...base,
      body: { canchaId: 'c1', clienteNombre: 'Juan', whatsapp: '+5491150000000', diaSemana: 5, horaInicio, horaFin },
    });
  const bloqueo = (horaInicio: string, horaFin: string) =>
    crearBloqueoSchema.safeParse({
      ...base,
      body: { canchaId: 'c1', motivo: 'MANTENIMIENTO', recurrente: true, diaSemana: 5, horaInicio, horaFin },
    });

  it('un turno fijo de 23:00 a 00:00 es válido', () => {
    expect(fijo('23:00', '00:00').success).toBe(true);
  });

  it('un bloqueo de 23:00 a 00:00 es válido', () => {
    expect(bloqueo('23:00', '00:00').success).toBe(true);
  });

  it('siguen rechazándose los rangos realmente invertidos', () => {
    expect(fijo('22:00', '18:00').success).toBe(false);
    expect(bloqueo('22:00', '18:00').success).toBe(false);
  });

  it('siguen rechazándose los rangos de duración cero', () => {
    expect(fijo('20:00', '20:00').success).toBe(false);
    expect(bloqueo('20:00', '20:00').success).toBe(false);
  });

  it('un rango normal sigue siendo válido', () => {
    expect(fijo('19:00', '20:00').success).toBe(true);
    expect(bloqueo('19:00', '20:00').success).toBe(true);
  });
});
