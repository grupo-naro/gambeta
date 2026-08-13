import { prisma } from '../db/prisma.js';
import { NotFound } from '../utils/errors.js';

export interface MostradorAdmin {
  id: string;
  nombre: string;
  tipo: 'PRINCIPAL' | 'SECUNDARIO';
  activo: boolean;
  /** Si tiene PIN cargado. Se expone esto y no el hash: el panel solo necesita saber si falta. */
  tienePin: boolean;
}

export const mostradorService = {
  /** Los puestos para el panel. El `pinHash` nunca sale de acá. */
  async listar(): Promise<MostradorAdmin[]> {
    const filas = await prisma.mostrador.findMany({ orderBy: { tipo: 'asc' } });
    return filas.map((m) => ({
      id: m.id,
      nombre: m.nombre,
      tipo: m.tipo as 'PRINCIPAL' | 'SECUNDARIO',
      activo: m.activo,
      tienePin: m.pinHash !== '',
    }));
  },

  /**
   * Activa o desactiva un puesto.
   *
   * Es la única forma de revocarle el acceso a un dispositivo: el token del mostrador no vence
   * y su firma solo cubre el id, así que cambiar el PIN no invalida los tokens ya emitidos.
   * `authMostrador` relee `activo` en cada request, con lo cual el corte es inmediato.
   */
  async setActivo(id: string, activo: boolean): Promise<MostradorAdmin> {
    const existe = await prisma.mostrador.findUnique({ where: { id } });
    if (!existe) throw NotFound('Mostrador', id);
    const m = await prisma.mostrador.update({ where: { id }, data: { activo } });
    return {
      id: m.id,
      nombre: m.nombre,
      tipo: m.tipo as 'PRINCIPAL' | 'SECUNDARIO',
      activo: m.activo,
      tienePin: m.pinHash !== '',
    };
  },
};
