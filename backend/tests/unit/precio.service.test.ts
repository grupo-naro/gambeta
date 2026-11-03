import { describe, it, expect, beforeAll } from 'vitest';
import { precioDeRango, reglasDeAgenda } from '../../src/services/precio.service.js';

beforeAll(() => { process.env.TZ_NEGOCIO ||= 'America/Argentina/Buenos_Aires'; });

// Franja del complejo real: pico de 18:00 a medianoche.
const cfg = { horaApertura: '16:00', horaAperturaFinde: '16:00', picoDesde: '18:00', picoHasta: '00:00', picoFindeDesde: '18:00', picoFindeHasta: '00:00' };
// Precios reales de la cancha de pádel.
const padel = { precioHora: 30000, precioHoraPico: 36000 };
// 2026-06-10 = miércoles (semana); 2026-06-13 = sábado (finde)

describe('precioDeRango', () => {
  it('banda base: el precio escala con la duración', () => {
    expect(precioDeRango(padel, '2026-06-10', '08:00', 60, cfg)).toBe(30000);
    expect(precioDeRango(padel, '2026-06-10', '08:00', 90, cfg)).toBe(45000);
    expect(precioDeRango(padel, '2026-06-10', '08:00', 120, cfg)).toBe(60000);
  });

  it('banda pico: el precio escala con la duración', () => {
    expect(precioDeRango(padel, '2026-06-10', '19:00', 60, cfg)).toBe(36000);
    expect(precioDeRango(padel, '2026-06-10', '19:00', 90, cfg)).toBe(54000);
    expect(precioDeRango(padel, '2026-06-10', '19:00', 120, cfg)).toBe(72000);
  });

  it('el precio lo define la hora de INICIO: un turno que arranca antes de las 18:00 va todo a tarifa barata', () => {
    // 17:00-19:00 arranca en banda base → 2 h de base (antes se prorrateaba: 66.000).
    expect(precioDeRango(padel, '2026-06-10', '17:00', 120, cfg)).toBe(60000);
    // 17:30-19:00 arranca en banda base → 1½ h de base (antes 51.000).
    expect(precioDeRango(padel, '2026-06-10', '17:30', 90, cfg)).toBe(45000);
  });

  it('un turno que cruza las 18:00 se cobra entero a tarifa barata si arrancó antes', () => {
    // 17:00-18:30 → todo el turno a tarifa base (antes 48.000).
    expect(precioDeRango(padel, '2026-06-10', '17:00', 90, cfg)).toBe(45000);
    // 17:30-18:30 → todo base (antes 33.000).
    expect(precioDeRango(padel, '2026-06-10', '17:30', 60, cfg)).toBe(30000);
    // También el fin de semana.
    expect(precioDeRango(padel, '2026-06-13', '17:00', 90, cfg)).toBe(45000);
  });

  it('un turno que ARRANCA en la franja cara no se abarata', () => {
    expect(precioDeRango(padel, '2026-06-10', '18:00', 60, cfg)).toBe(36000);
    expect(precioDeRango(padel, '2026-06-10', '18:30', 60, cfg)).toBe(36000);
  });

  it('REGRESIÓN: una franja que termina a medianoche SÍ se aplica', () => {
    // El bug viejo comparaba strings: "18:00" >= "00:00" daba true y devolvía el precio base.
    expect(precioDeRango(padel, '2026-06-10', '19:00', 60, cfg)).toBe(36000);
    expect(precioDeRango(padel, '2026-06-10', '22:30', 90, cfg)).toBe(54000); // termina justo en el cierre
  });

  it('bordes de la franja: desde inclusive, hasta exclusivo', () => {
    expect(precioDeRango(padel, '2026-06-10', '18:00', 60, cfg)).toBe(36000);
    expect(precioDeRango(padel, '2026-06-10', '17:00', 60, cfg)).toBe(30000);
  });

  it('sin pico en la cancha (precioHoraPico=0) → todo a base', () => {
    expect(precioDeRango({ precioHora: 30000, precioHoraPico: 0 }, '2026-06-10', '19:00', 120, cfg)).toBe(60000);
  });

  it('franja vacía o invertida → todo a base', () => {
    const vacia = { picoDesde: '', picoHasta: '', picoFindeDesde: '', picoFindeHasta: '' };
    expect(precioDeRango(padel, '2026-06-10', '19:00', 60, vacia)).toBe(30000);
    const invertida = { horaApertura: '00:00', horaAperturaFinde: '00:00', picoDesde: '22:00', picoHasta: '20:00', picoFindeDesde: '22:00', picoFindeHasta: '20:00' };
    expect(precioDeRango(padel, '2026-06-10', '19:00', 60, invertida)).toBe(30000);
  });

  it('el finde usa su propia franja', () => {
    const mixta = { horaApertura: '00:00', horaAperturaFinde: '00:00', picoDesde: '19:00', picoHasta: '23:00', picoFindeDesde: '14:00', picoFindeHasta: '23:00' };
    expect(precioDeRango(padel, '2026-06-13', '14:00', 60, mixta)).toBe(36000); // sábado, en franja finde
    expect(precioDeRango(padel, '2026-06-10', '14:00', 60, mixta)).toBe(30000); // miércoles, fuera de franja semana
  });
});

describe('precio propio por duración', () => {
  const cfg = { horaApertura: '16:00', horaAperturaFinde: '16:00', picoDesde: '18:00', picoHasta: '00:00', picoFindeDesde: '18:00', picoFindeHasta: '00:00' };
  // 2026-06-10 es miércoles (semana).
  const conPropio = {
    precioHora: 27000, precioHoraPico: 33000,
    precio90: 36000, precio90Pico: 45000,
    precio120: null, precio120Pico: null,
  };

  it('usa el precio propio de 1½ hora en vez del proporcional', () => {
    // Proporcional daría 27.000 × 1,5 = 40.500. Con precio propio, 36.000.
    expect(precioDeRango(conPropio, '2026-06-10', '08:00', 90, cfg)).toBe(36000);
  });

  it('usa el precio propio de pico cuando el turno cae entero en pico', () => {
    expect(precioDeRango(conPropio, '2026-06-10', '19:00', 90, cfg)).toBe(45000);
  });

  it('cruza el borde por solo 30 min: se cobra el precio propio de base (no interpola)', () => {
    // 17:00–18:30 arranca en base → precio propio de 1½ h en banda base = 36.000 (antes 39.000).
    expect(precioDeRango(conPropio, '2026-06-10', '17:00', 90, cfg)).toBe(36000);
  });

  it('REGRESIÓN cliente: 1½ h cuesta 55.000 si arranca antes de las 18:00 y 65.000 si arranca desde las 18:00', () => {
    const real = { precioHora: 40000, precioHoraPico: 50000, precio90: 55000, precio90Pico: 65000, precio120: 60000, precio120Pico: 75000 };
    expect(precioDeRango(real, '2026-06-10', '17:30', 90, cfg)).toBe(55000); // antes: 61.667
    expect(precioDeRango(real, '2026-06-10', '17:00', 90, cfg)).toBe(55000);
    expect(precioDeRango(real, '2026-06-10', '18:00', 90, cfg)).toBe(65000);
    expect(precioDeRango(real, '2026-06-10', '17:00', 120, cfg)).toBe(60000);
    expect(precioDeRango(real, '2026-06-10', '18:00', 120, cfg)).toBe(75000);
  });

  it('una duración sin precio propio cae al proporcional', () => {
    // precio120 es null: 2 horas usa precioHora × 2.
    expect(precioDeRango(conPropio, '2026-06-10', '08:00', 120, cfg)).toBe(54000);
  });

  it('1 hora nunca se ve afectada: precioHora YA es su precio propio', () => {
    expect(precioDeRango(conPropio, '2026-06-10', '08:00', 60, cfg)).toBe(27000);
    expect(precioDeRango(conPropio, '2026-06-10', '19:00', 60, cfg)).toBe(33000);
  });

  it('REGRESIÓN: sin campos nuevos el resultado es idéntico al de hoy', () => {
    const sinPropio = { precioHora: 30000, precioHoraPico: 36000 };
    expect(precioDeRango(sinPropio, '2026-06-10', '08:00', 90, cfg)).toBe(45000);
    expect(precioDeRango(sinPropio, '2026-06-10', '17:00', 120, cfg)).toBe(60000);
  });
});

describe('reglasDeAgenda', () => {
  it('futbol se agenda por hora en punto y solo de una hora', () => {
    for (const tipo of ['futbol5', 'futbol7', 'FUTBOL11', 'futbol']) {
      const r = reglasDeAgenda(tipo);
      expect(r.pasoMin).toBe(60);
      expect([...r.duracionesMin]).toEqual([60]);
    }
  });

  it('padel admite media hora de paso y turnos de hasta dos horas', () => {
    const r = reglasDeAgenda('padel');
    expect(r.pasoMin).toBe(30);
    expect([...r.duracionesMin]).toEqual([60, 90, 120]);
  });

  it('un tipo desconocido se comporta como padel, no como futbol', () => {
    // Criterio deliberado: solo el futbol tiene la restriccion. Cualquier deporte nuevo
    // que agregue el complejo arranca con la agenda flexible.
    const r = reglasDeAgenda('tenis');
    expect(r.pasoMin).toBe(30);
    expect([...r.duracionesMin]).toEqual([60, 90, 120]);
  });
});

describe('reglasDeAgenda con bloque fijo (pádel escalonado)', () => {
  it('inicios cada hora conservan 1, 1½ y 2 h, con el primer turno corrido por el desfase', () => {
    expect(reglasDeAgenda({ tipo: 'padel', turnoBloqueMin: 60, turnoDesfaseMin: 30 }))
      .toEqual({ pasoMin: 60, duracionesMin: [60, 90, 120], desfaseMin: 30, bloqueFijo: true });
  });
  it('un bloque de 90 con desfase 30 ofrece un solo largo y paso igual al bloque', () => {
    expect(reglasDeAgenda({ tipo: 'padel', turnoBloqueMin: 90, turnoDesfaseMin: 30 }))
      .toEqual({ pasoMin: 90, duracionesMin: [90], desfaseMin: 30, bloqueFijo: true });
  });
  it('sin bloque conserva la agenda libre del deporte', () => {
    expect(reglasDeAgenda({ tipo: 'padel', turnoBloqueMin: null })).toMatchObject({ pasoMin: 30, bloqueFijo: false, desfaseMin: 0 });
    expect(reglasDeAgenda('futbol5')).toMatchObject({ pasoMin: 60, duracionesMin: [60], bloqueFijo: false });
  });
});

describe('reglasDeAgenda con primer turno corrido y agenda libre', () => {
  it('conserva el paso de media hora y las 3 duraciones, y expone el desfase', () => {
    expect(reglasDeAgenda({ tipo: 'padel', turnoBloqueMin: null, turnoDesfaseMin: 60 }))
      .toEqual({ pasoMin: 30, duracionesMin: [60, 90, 120], desfaseMin: 60, bloqueFijo: false });
  });
});
