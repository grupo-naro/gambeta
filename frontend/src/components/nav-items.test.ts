import { describe, it, expect } from 'vitest';
import { navAgrupado, GRUPOS } from './nav-items';

describe('GRUPOS', () => {
  it('define el orden canonico de los grupos', () => {
    expect(GRUPOS).toEqual(['Operación', 'Programación', 'Administración']);
  });
});

describe('navAgrupado', () => {
  it('ADMIN ve los 3 grupos, en orden y con las cantidades correctas', () => {
    const r = navAgrupado('ADMIN');
    expect(r.map((g) => g.grupo)).toEqual(['Operación', 'Programación', 'Administración']);
    expect(r.map((g) => g.items.length)).toEqual([6, 3, 4]);
  });

  it('RECEPCIONISTA ve solo Operación y Programación (sin Administración)', () => {
    const r = navAgrupado('RECEPCIONISTA');
    expect(r.map((g) => g.grupo)).toEqual(['Operación', 'Programación']);
    expect(r.map((g) => g.items.length)).toEqual([5, 1]);
    expect(r[1].items[0].href).toBe('/turnos-fijos'); // único de Programación visible para recepción
  });

  it('nunca devuelve un item fuera del alcance del rol', () => {
    for (const rol of ['ADMIN', 'RECEPCIONISTA'] as const) {
      for (const g of navAgrupado(rol)) {
        for (const item of g.items) expect(item.roles).toContain(rol);
      }
    }
  });

  it('nunca devuelve un grupo vacio', () => {
    for (const rol of ['ADMIN', 'RECEPCIONISTA'] as const) {
      for (const g of navAgrupado(rol)) expect(g.items.length).toBeGreaterThan(0);
    }
  });
});
