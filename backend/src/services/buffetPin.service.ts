import { prisma } from '../db/prisma.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { Conflict } from '../utils/errors.js';

export interface MostradorIdentificado { mostradorId: string; tipo: 'PRINCIPAL' | 'SECUNDARIO'; nombre: string }

export const buffetPinService = {
  async setear(mostradorId: string, pin: string): Promise<void> {
    // Si el mismo PIN ya abre OTRO mostrador, "quién vendió" pasaría a depender del orden de
    // filas en Postgres — que ni siquiera es estable — en vez del PIN. Se rechaza acá, antes de
    // escribir, con un mensaje que el admin pueda entender.
    const otros = await prisma.mostrador.findMany({ where: { id: { not: mostradorId }, activo: true }, orderBy: { id: 'asc' } });
    for (const otro of otros) {
      if (!otro.pinHash) continue;
      if (await verifyPassword(pin, otro.pinHash)) {
        throw Conflict(`Ese PIN ya está en uso por "${otro.nombre}"`);
      }
    }
    await prisma.mostrador.update({ where: { id: mostradorId }, data: { pinHash: await hashPassword(pin) } });
  },

  /**
   * Devuelve QUÉ mostrador es, no solo si el PIN sirve. Recorre los mostradores activos en un
   * orden determinístico (por más que `setear` ya evite los PINs duplicados, un orden estable
   * evita que datos viejos o una carrera hagan que "quién entró" cambie de un request a otro) y
   * compara contra cada hash: son dos, así que el costo es irrelevante.
   */
  async verificar(pin: string): Promise<MostradorIdentificado | null> {
    const mostradores = await prisma.mostrador.findMany({ where: { activo: true }, orderBy: { id: 'asc' } });
    for (const m of mostradores) {
      // Un hash vacío nunca matchea: un mostrador sin PIN configurado no deja entrar a nadie.
      if (!m.pinHash) continue;
      if (await verifyPassword(pin, m.pinHash)) {
        return { mostradorId: m.id, tipo: m.tipo as 'PRINCIPAL' | 'SECUNDARIO', nombre: m.nombre };
      }
    }
    return null;
  },
};
