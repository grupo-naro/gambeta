import { describe, it, expect } from 'vitest';
import { clasesDeAcademia, estadoClase, filtrarClases, nombreClase } from './academia';
import type { Bloqueo } from './types';

const bl = (o: Partial<Bloqueo>): Bloqueo => ({
  id: 'b1', canchaId: 'c1', motivo: 'ENTRENAMIENTO', recurrente: true, diaSemana: 2,
  fecha: null, horaInicio: '17:00', horaFin: '18:00', nota: 'Clase Nahuel', ...o,
});

describe('clasesDeAcademia', () => {
  it('deja solo los entrenamientos recurrentes', () => {
    const lista = [
      bl({ id: 'a' }),
      bl({ id: 'b', motivo: 'TORNEO' }),
      bl({ id: 'c', motivo: 'MANTENIMIENTO', recurrente: false, fecha: '2026-11-10' }),
      bl({ id: 'd', motivo: 'ENTRENAMIENTO', recurrente: false, fecha: '2026-11-10' }),
    ];
    expect(clasesDeAcademia(lista).map((b) => b.id)).toEqual(['a']);
  });
});

describe('nombreClase', () => {
  it('usa la nota como nombre y, sin nota, "Entrenamiento"', () => {
    expect(nombreClase(bl({ nota: '  Clase Nahuel ' }))).toBe('Clase Nahuel');
    expect(nombreClase(bl({ nota: null }))).toBe('Entrenamiento');
    expect(nombreClase(bl({ nota: '   ' }))).toBe('Entrenamiento');
  });
});

describe('filtrarClases', () => {
  const lista = [bl({ id: 'a', nota: 'Clase Nahuel' }), bl({ id: 'b', nota: 'Escuelita infantil' }), bl({ id: 'c', nota: null })];
  it('sin texto devuelve todo', () => { expect(filtrarClases(lista, '  ')).toHaveLength(3); });
  it('busca sin importar mayúsculas ni tildes', () => {
    expect(filtrarClases(lista, 'nahuel').map((b) => b.id)).toEqual(['a']);
    expect(filtrarClases(lista, 'ESCUELITA').map((b) => b.id)).toEqual(['b']);
    expect(filtrarClases([bl({ id: 'x', nota: 'Pádel Martín' })], 'padel martin')).toHaveLength(1);
  });
});

describe('estadoClase', () => {
  const meses = [
    { mes: '2026-10', pagado: 0, saldo: 50000 },
    { mes: '2026-11', pagado: 20000, saldo: 30000 },
  ];
  it('sin valor por mes no se puede cobrar', () => {
    expect(estadoClase(null, undefined, '2026-11')).toEqual({ tipo: 'sin-valor', texto: 'Sin valor por mes', saldo: 0 });
  });
  it('mes actual con saldo: debe lo que falta', () => {
    const e = estadoClase(50000, meses, '2026-11');
    expect(e.tipo).toBe('debe');
    expect(e.saldo).toBe(30000);
    expect(e.texto).toBe('Debe $30.000');
  });
  it('mes actual pago', () => {
    expect(estadoClase(50000, [{ mes: '2026-11', pagado: 50000, saldo: 0 }], '2026-11')).toEqual({ tipo: 'pago', texto: 'Al día', saldo: 0 });
  });
  it('si el mes actual no está en el período, la clase terminó', () => {
    expect(estadoClase(50000, [{ mes: '2026-09', pagado: 0, saldo: 50000 }], '2026-11').tipo).toBe('fuera');
  });
});
