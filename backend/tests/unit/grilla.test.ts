import { describe, it, expect } from 'vitest';
import { construirGrillaDia, colorPorTipo, type ReservaCelda } from '../../src/services/sheets/grilla.js';

const canchas = [{ id: 'c1', nombre: 'Cancha 1' }, { id: 'c2', nombre: 'Cancha 2' }];
const horas = ['16:00', '17:00', '18:00'];

function celda(o: Partial<ReservaCelda>): ReservaCelda {
  return { canchaId: 'c1', hora: '17:00', cliente: 'Juan', monto: 10000, pagado: 0, tipo: 'suelto', ...o };
}

describe('construirGrillaDia', () => {
  it('header con A vacío + pares; ubica la reserva en (cancha, hora)', () => {
    const g = construirGrillaDia(horas, canchas, [celda({ canchaId: 'c1', hora: '17:00', cliente: 'Juan', monto: 10000, tipo: 'suelto' })]);
    expect(g.header).toEqual(['', 'Cancha 1', '$$', 'Cancha 2', '$$']);
    const f17 = g.filas.find((f) => f.hora === '17:00')!;
    expect(f17.celdas[0].texto).toBe('Juan');
    expect(f17.celdas[1].texto).toBe('$10.000');
    expect(f17.celdas[0].colorTexto).toEqual(colorPorTipo('suelto'));
    expect(f17.celdas[1].colorTexto).toBe(null);
    expect(f17.celdas[2].texto).toBe('');
    expect(g.nCanchas).toBe(2);
  });

  it('color de TEXTO por tipo: fijo=negro, suelto=rojo, escuela=naranja, torneo=violeta', () => {
    const g = construirGrillaDia(horas, canchas, [
      celda({ canchaId: 'c1', hora: '16:00', tipo: 'fijo' }),
      celda({ canchaId: 'c2', hora: '16:00', tipo: 'escuela' }),
      celda({ canchaId: 'c1', hora: '17:00', tipo: 'suelto' }),
      celda({ canchaId: 'c2', hora: '17:00', tipo: 'torneo' }),
    ]);
    const f16 = g.filas.find((f) => f.hora === '16:00')!;
    expect(f16.celdas[0].colorTexto).toEqual({ red: 0, green: 0, blue: 0 });        // fijo negro
    expect(f16.celdas[2].colorTexto).toEqual({ red: 0.9, green: 0.45, blue: 0 });   // escuela naranja
    const f17 = g.filas.find((f) => f.hora === '17:00')!;
    expect(f17.celdas[0].colorTexto).toEqual({ red: 0.8, green: 0, blue: 0 });      // suelto rojo
    expect(f17.celdas[2].colorTexto).toEqual({ red: 0.5, green: 0.2, blue: 0.7 });  // torneo violeta
  });

  it('totales por cancha y total general', () => {
    const g = construirGrillaDia(horas, canchas, [
      celda({ canchaId: 'c1', hora: '16:00', monto: 10000 }),
      celda({ canchaId: 'c2', hora: '17:00', monto: 5000 }),
    ]);
    expect(g.totalesPorCancha).toEqual([10000, 5000]);
    expect(g.totalGeneral).toBe(15000);
  });
});
