import { clienteRepo, type UpsertClienteInput } from '../repositories/cliente.repo.js';
import { reservaRepo } from '../repositories/reserva.repo.js';
import { NotFound, Conflict } from '../utils/errors.js';

export const clienteService = {
  list: async () => {
    const [cs, counts] = await Promise.all([clienteRepo.list(), reservaRepo.cumplidasPorCliente()]);
    return cs.map((c) => {
      const cumplidas = counts.get(c.id) ?? 0;
      return { ...c, cumplidas, confianza: c.confiable };
    });
  },
  get: async (id: string) => {
    const c = await clienteRepo.findById(id);
    if (!c) throw NotFound('Cliente', id);
    return c;
  },
  upsert: (input: UpsertClienteInput) => clienteRepo.upsert(input),
  editar: async (id: string, data: { nombre?: string; confiable?: boolean; whatsapp?: string }) => {
    const c = await clienteRepo.findById(id);
    if (!c) throw NotFound('Cliente', id);
    const patch: { nombre?: string; confiable?: boolean; nombreConfirmado?: boolean; whatsapp?: string } = {};
    if (data.nombre !== undefined) { patch.nombre = data.nombre; patch.nombreConfirmado = true; }
    if (data.confiable !== undefined) patch.confiable = data.confiable;
    if (data.whatsapp !== undefined) {
      const otro = await clienteRepo.findByWhatsapp(data.whatsapp);
      if (otro && otro.id !== id) throw Conflict('Ya existe un cliente con ese WhatsApp');
      patch.whatsapp = data.whatsapp;
    }
    return clienteRepo.update(id, patch);
  },
  eliminar: async (id: string) => {
    const c = await clienteRepo.findById(id);
    if (!c) throw NotFound('Cliente', id);
    if (c.reservas.length > 0) throw Conflict('No se puede eliminar: el cliente tiene reservas');
    await clienteRepo.delete(id);
    return { ok: true };
  },
  buscarPorWhatsapp: async (whatsapp: string) => {
    const c = await clienteRepo.findByWhatsapp(whatsapp);
    return c ? { id: c.id, nombre: c.nombre, nombreConfirmado: c.nombreConfirmado } : null;
  },
};
