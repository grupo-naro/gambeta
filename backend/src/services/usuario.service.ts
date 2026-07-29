import { adminUserRepo } from '../repositories/adminUser.repo.js';
import { hashPassword } from '../utils/password.js';
import { Conflict, NotFound, Forbidden } from '../utils/errors.js';

export const usuarioService = {
  list: () => adminUserRepo.list(),
  crear: async (input: { email: string; nombre: string; password: string; rol: 'ADMIN' | 'RECEPCIONISTA'; duracionDias?: 1 | 2 | 7 | 30 }) => {
    if (await adminUserRepo.findByEmail(input.email)) throw Conflict('Ya existe un usuario con ese email');
    const expiraEn = input.duracionDias ? new Date(Date.now() + input.duracionDias * 86_400_000) : null;
    try {
      return await adminUserRepo.create({ email: input.email, nombre: input.nombre, passwordHash: await hashPassword(input.password), rol: input.rol, expiraEn });
    } catch (e: any) {
      if (e?.code === 'P2002') throw Conflict('Ya existe un usuario con ese email');
      throw e;
    }
  },
  cambiarRol: async (id: string, rol: 'ADMIN' | 'RECEPCIONISTA', currentAdminId: string) => {
    if (id === currentAdminId) throw Forbidden('No podés cambiar tu propio rol');
    const u = await adminUserRepo.findById(id);
    if (!u) throw NotFound('Usuario', id);
    if (u.esDefault) throw Forbidden('No se puede cambiar el rol del administrador por defecto');
    return adminUserRepo.updateRol(id, rol);
  },
  cambiarExpiracion: async (id: string, duracionDias: 1 | 2 | 7 | 30 | null, currentAdminId: string) => {
    if (id === currentAdminId) throw Forbidden('No podés cambiar tu propio vencimiento');
    const u = await adminUserRepo.findById(id);
    if (!u) throw NotFound('Usuario', id);
    if (u.esDefault) throw Forbidden('No se puede vencer el administrador por defecto');
    const expiraEn = duracionDias ? new Date(Date.now() + duracionDias * 86_400_000) : null;
    return adminUserRepo.updateExpiracion(id, expiraEn);
  },
  eliminar: async (id: string, currentAdminId: string) => {
    const u = await adminUserRepo.findById(id);
    if (!u) throw NotFound('Usuario', id);
    if (u.esDefault) throw Forbidden('No se puede eliminar el administrador por defecto');
    if (id === currentAdminId) throw Forbidden('No podés eliminar tu propio usuario');
    await adminUserRepo.remove(id);
    return { ok: true };
  },
};
