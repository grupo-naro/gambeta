import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTables, getPrisma } from '../helpers/db.js';
import { alquilerArticuloService } from '../../src/services/alquilerArticulo.service.js';

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(resetTables);

describe('catálogo de alquileres', () => {
  it('crear devuelve disponible = stock - prestado', async () => {
    const a = await alquilerArticuloService.crear({ nombre: 'Raqueta', precio: 3000, stock: 6 });
    expect(a.disponible).toBe(6);
    expect(a.precio).toBe(3000);
  });

  it('disponible descuenta lo prestado', async () => {
    const a = await alquilerArticuloService.crear({ nombre: 'Raqueta', precio: 3000, stock: 6 });
    await getPrisma().articuloAlquiler.update({ where: { id: a.id }, data: { prestado: 2 } });
    const [visto] = await alquilerArticuloService.list();
    expect(visto!.disponible).toBe(4);
  });

  it('la botonera solo trae los activos, por orden', async () => {
    await alquilerArticuloService.crear({ nombre: 'Segunda', precio: 100, orden: 2 });
    await alquilerArticuloService.crear({ nombre: 'Primera', precio: 100, orden: 1 });
    await alquilerArticuloService.crear({ nombre: 'Guardada', precio: 100, orden: 0, activo: false });
    const botonera = await alquilerArticuloService.listBotonera();
    expect(botonera.map((a) => a.nombre)).toEqual(['Primera', 'Segunda']);
  });

  it('ajustarStock suma y resta', async () => {
    const a = await alquilerArticuloService.crear({ nombre: 'Pelota', precio: 500, stock: 3 });
    const mas = await alquilerArticuloService.ajustarStock(a.id, 2, 'admin-1');
    expect(mas.stock).toBe(5);
    const menos = await alquilerArticuloService.ajustarStock(a.id, -1, 'admin-1');
    expect(menos.stock).toBe(4);
  });

  it('no deja bajar el stock por debajo de lo que está afuera', async () => {
    const a = await alquilerArticuloService.crear({ nombre: 'Pechera', precio: 500, stock: 4 });
    await getPrisma().articuloAlquiler.update({ where: { id: a.id }, data: { prestado: 3 } });
    await expect(alquilerArticuloService.ajustarStock(a.id, -2, 'admin-1')).rejects.toMatchObject({ status: 422 });
    const sinCambios = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: a.id } });
    expect(sinCambios.stock).toBe(4);
  });

  it('actualizar sobre un id inexistente da 404', async () => {
    await expect(alquilerArticuloService.actualizar('no-existe', { nombre: 'X' })).rejects.toMatchObject({ status: 404 });
  });

  it('dos ajustes simultáneos no se pisan', async () => {
    const a = await alquilerArticuloService.crear({ nombre: 'Pelota', precio: 500, stock: 5 });
    await Promise.all([
      alquilerArticuloService.ajustarStock(a.id, 3, 'admin-1'),
      alquilerArticuloService.ajustarStock(a.id, 3, 'admin-1'),
    ]);
    const final = await getPrisma().articuloAlquiler.findUniqueOrThrow({ where: { id: a.id } });
    expect(final.stock).toBe(11);
  });
});
