import { describe, it, expect } from 'vitest';
import { expandirSemana, type FijoInput, type BloqueoInput } from '../../src/services/sheets/expandir.js';
import type { ReservaCelda } from '../../src/services/sheets/grilla.js';

const TZ = 'America/Argentina/Buenos_Aires';
// Semana con lunes 2026-06-29 (lunes) … usamos 2 días para los tests.
const dias = [
  { dia: 'LUNES', fecha: '2026-06-29' },   // lunes (dow 1)
  { dia: 'MARTES', fecha: '2026-06-30' },  // martes (dow 2)
];
const horas = ['18:00', '19:00', '20:00', '21:00'];

const fijo = (o: Partial<FijoInput>): FijoInput => ({ canchaId: 'c1', clienteNombre: 'Pepe', diaSemana: 1, horaInicio: '20:00', horaFin: '22:00', precio: 10000, excepciones: [], ...o });
const bloqueo = (o: Partial<BloqueoInput>): BloqueoInput => ({ canchaId: 'c1', motivo: 'TORNEO', recurrente: true, diaSemana: 1, fecha: null, horaInicio: '20:00', horaFin: '22:00', nota: null, excepciones: [], ...o });

describe('expandirSemana', () => {
  it('un fijo de lunes 20-22 aparece el lunes en 20 y 21, tipo fijo', () => {
    const out = expandirSemana({ reservas: [], fijos: [fijo({})], bloqueos: [] }, dias, horas, TZ);
    const lun = out.filter((c) => c.fecha === '2026-06-29');
    expect(lun.map((c) => c.hora).sort()).toEqual(['20:00', '21:00']);
    expect(lun.every((c) => c.tipo === 'fijo' && c.cliente === 'Pepe' && c.monto === 10000)).toBe(true);
    expect(out.some((c) => c.fecha === '2026-06-30')).toBe(false); // no es martes
  });

  it('una excepción en esa fecha excluye el fijo', () => {
    const out = expandirSemana({ reservas: [], fijos: [fijo({ excepciones: ['2026-06-29'] })], bloqueos: [] }, dias, horas, TZ);
    expect(out.length).toBe(0);
  });

  it('bloqueo recurrente (TORNEO) por diaSemana → tipo torneo; puntual sólo en su fecha', () => {
    const rec = expandirSemana({ reservas: [], fijos: [], bloqueos: [bloqueo({})] }, dias, horas, TZ);
    expect(rec.filter((c) => c.fecha === '2026-06-29').map((c) => c.hora).sort()).toEqual(['20:00', '21:00']);
    expect(rec.every((c) => c.tipo === 'torneo')).toBe(true);
    const punt = expandirSemana({ reservas: [], fijos: [], bloqueos: [bloqueo({ recurrente: false, diaSemana: null, fecha: '2026-06-30' })] }, dias, horas, TZ);
    expect(punt.every((c) => c.fecha === '2026-06-30')).toBe(true);
  });

  it('dedupe: si hay reserva en cancha|fecha|hora, el fijo no se duplica', () => {
    const reservas: ReservaCelda[] = [{ canchaId: 'c1', fecha: '2026-06-29', hora: '20:00', cliente: 'Reserva', monto: 5000, pagado: 0, tipo: 'suelto' }];
    const out = expandirSemana({ reservas, fijos: [fijo({})], bloqueos: [] }, dias, horas, TZ);
    const en20 = out.filter((c) => c.fecha === '2026-06-29' && c.hora === '20:00');
    expect(en20).toHaveLength(1);
    expect(en20[0].cliente).toBe('Reserva'); // gana la reserva
  });

  it('horas fuera del rango de config se descartan', () => {
    const out = expandirSemana({ reservas: [], fijos: [fijo({ horaInicio: '08:00', horaFin: '10:00' })], bloqueos: [] }, dias, horas, TZ);
    expect(out.length).toBe(0); // 08 y 09 no están en horas
  });
});
