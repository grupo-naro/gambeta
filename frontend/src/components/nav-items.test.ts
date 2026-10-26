import { describe, it, expect } from 'vitest';
import { nav, navAgrupado, GRUPOS } from './nav-items';
import { SOCIOS_HABILITADO } from '@/lib/features';

// Socios entra al menú detrás de un flag. Las expectativas se derivan de él en vez de
// quedar fijas, para que estos tests sigan siendo correctos si algún día se reactiva.
const CON_SOCIOS = SOCIOS_HABILITADO ? 1 : 0;

describe('GRUPOS', () => {
  it('define el orden canonico de los grupos', () => {
    expect(GRUPOS).toEqual(['Operación', 'Programación', 'Administración']);
  });
});

describe('navAgrupado', () => {
  it('ADMIN ve los 3 grupos, en orden y con las cantidades correctas', () => {
    const r = navAgrupado('ADMIN');
    expect(r.map((g) => g.grupo)).toEqual(['Operación', 'Programación', 'Administración']);
    expect(r.map((g) => g.items.length)).toEqual([8, 3, 4 + CON_SOCIOS]);
  });

  it('RECEPCIONISTA ve solo Operación y Programación (sin Administración)', () => {
    const r = navAgrupado('RECEPCIONISTA');
    expect(r.map((g) => g.grupo)).toEqual(['Operación', 'Programación']);
    expect(r.map((g) => g.items.length)).toEqual([6, 1]);
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

describe('socios en el menu', () => {
  it('sigue el flag: si está apagado no aparece para nadie', () => {
    const paraAdmin = navAgrupado('ADMIN').find((g) => g.grupo === 'Administración')!;
    expect(paraAdmin.items.some((i) => i.href === '/socios')).toBe(SOCIOS_HABILITADO);
  });
  it('NO es visible para RECEPCIONISTA, ni siquiera con el flag prendido', () => {
    expect(navAgrupado('RECEPCIONISTA').flatMap((g) => g.items).some((i) => i.href === '/socios')).toBe(false);
  });
  it('esta declarado una sola vez', () => {
    expect(nav.filter((i) => i.href === '/socios')).toHaveLength(CON_SOCIOS);
  });
});
