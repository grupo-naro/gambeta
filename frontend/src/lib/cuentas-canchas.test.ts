import { describe, it, expect } from 'vitest';
import { agruparCanchas } from './cuentas-canchas';
import type { CanchaMostrador } from './types';

const g1 = { id: 'g1', nombre: 'CANCHA 1' };
const g2 = { id: 'g2', nombre: 'CANCHA 2' };
const c = (id: string, nombre: string, extra: Partial<CanchaMostrador> = {}): CanchaMostrador => ({ id, nombre, ...extra });

describe('agruparCanchas', () => {
  it('junta la cancha de 9 con sus tres de 6, un bloque por cancha', () => {
    const canchas = [
      c('e1', 'CANCHA 1', { esEntera: true, jugadores: 9, grupo: g1 }),
      c('p11', 'CANCHA 1 - 1', { jugadores: 6, grupo: g1 }),
      c('p12', 'CANCHA 1 - 2', { jugadores: 6, grupo: g1 }),
      c('p13', 'CANCHA 1 - 3', { jugadores: 6, grupo: g1 }),
      c('e2', 'CANCHA 2', { esEntera: true, jugadores: 9, grupo: g2 }),
      c('p21', 'CANCHA 2 - 1', { jugadores: 6, grupo: g2 }),
    ];
    const { bloques, sueltas } = agruparCanchas(canchas);
    expect(sueltas).toEqual([]);
    expect(bloques.map((b) => b.nombre)).toEqual(['CANCHA 1', 'CANCHA 2']);
    expect(bloques[0].entera?.id).toBe('e1');
    expect(bloques[0].partes.map((p) => p.id)).toEqual(['p11', 'p12', 'p13']);
    expect(bloques[1].partes.map((p) => p.id)).toEqual(['p21']);
  });

  it('las partes salen ordenadas aunque lleguen mezcladas, y 10 va después de 9', () => {
    const canchas = [
      c('p3', 'CANCHA 1 - 3', { grupo: g1 }), c('e', 'CANCHA 1', { esEntera: true, grupo: g1 }), c('p1', 'CANCHA 1 - 1', { grupo: g1 }),
    ];
    expect(agruparCanchas(canchas).bloques[0].partes.map((p) => p.id)).toEqual(['p1', 'p3']);
    const bloques = agruparCanchas([c('a', 'CANCHA 10', { grupo: { id: 'x', nombre: 'CANCHA 10' } }), c('b', 'CANCHA 9', { grupo: { id: 'y', nombre: 'CANCHA 9' } })]).bloques;
    expect(bloques.map((b) => b.nombre)).toEqual(['CANCHA 9', 'CANCHA 10']);
  });

  it('las canchas sin grupo (pádel) quedan sueltas', () => {
    const { bloques, sueltas } = agruparCanchas([c('p1', 'Pádel 1', { grupo: null }), c('p2', 'Pádel 2')]);
    expect(bloques).toEqual([]);
    expect(sueltas.map((x) => x.id)).toEqual(['p1', 'p2']);
  });

  it('un bloque sin la entera (solo las partes) igual se arma', () => {
    const { bloques } = agruparCanchas([c('p1', 'CANCHA 1 - 1', { grupo: g1 })]);
    expect(bloques[0].entera).toBeNull();
    expect(bloques[0].partes).toHaveLength(1);
  });
});
