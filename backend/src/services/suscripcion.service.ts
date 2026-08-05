import { getEnv } from '../config/env.js';
import { suscripcionRepo } from '../repositories/suscripcion.repo.js';
import { aFechaUtc, deFechaUtc, estadoVista, hoyEnTz, inicioRenovacion, sumarUnMes } from './suscripcion.vigencia.js';
import { prisma } from '../db/prisma.js';
import { clienteRepo } from '../repositories/cliente.repo.js';
import { cobroRepo } from '../repositories/cobro.repo.js';
import { adminUserRepo } from '../repositories/adminUser.repo.js';
import { Conflict, NotFound } from '../utils/errors.js';
import { SOCIOS_HABILITADO } from '../config/features.js';

export interface CrearSuscripcionInput {
  clienteId: string;
  inicio: string;
  vencimiento: string;
  precio?: number;
  medio?: 'EFECTIVO' | 'TRANSFERENCIA';
  nota?: string;
}

/** Evita una violación de FK si el token trae un adminId que ya no existe (mismo guard que cobroService). */
async function adminValido(adminId: string | null): Promise<string | null> {
  if (!adminId) return null;
  return (await adminUserRepo.findById(adminId)) ? adminId : null;
}

export const suscripcionService = {
  /**
   * ÚNICA función que decide si alguien es socio. Todo lo demás (reservas, panel, web)
   * consume esto; nunca reimplementa la regla.
   *
   * Recibe `clienteId` y no `whatsapp` porque `reserva.service.crear` ya buscó el cliente
   * unas líneas antes: así se reutiliza esa consulta en vez de hacer un join extra.
   *
   * Justamente por ser el único punto de entrada de la bonificación al flujo de reservas
   * (`reserva.service.crear` y `turnoFijo.service`), apagarla acá la apaga entera: sin
   * suscripción vigente, `resolverCondiciones` nunca toma la rama de socio.
   */
  async vigenteDe(clienteId: string, fecha?: string) {
    if (!SOCIOS_HABILITADO) return null;
    const ymd = fecha ?? hoyEnTz(getEnv().TZ_NEGOCIO);
    const encontradas = await suscripcionRepo.cubriendo(clienteId, aFechaUtc(ymd));
    return encontradas[0] ?? null;
  },

  async crear(input: CrearSuscripcionInput, adminId: string | null) {
    const cliente = await clienteRepo.findById(input.clienteId);
    if (!cliente) throw NotFound('Cliente', input.clienteId);
    const inicio = aFechaUtc(input.inicio);
    const vencimiento = aFechaUtc(input.vencimiento);
    const registradoPorId = await adminValido(adminId);

    return prisma.$transaction(async (tx) => {
      const solapadas = await suscripcionRepo.solapadas(input.clienteId, inicio, vencimiento, tx);
      if (solapadas.length > 0) throw Conflict('El cliente ya tiene una suscripción activa en ese período');

      const s = await suscripcionRepo.create({
        clienteId: input.clienteId,
        inicio,
        vencimiento,
        precio: input.precio ?? null,
        nota: input.nota ?? null,
        creadoPorId: registradoPorId,
      }, tx);

      if (input.precio != null && input.precio > 0) {
        await cobroRepo.create({
          suscripcionId: s.id,
          reservaId: null,
          monto: input.precio,
          medio: input.medio!,
          origen: 'SUSCRIPCION',
          registradoPorId,
        }, tx);
      }
      return s;
    });
  },

  /**
   * Renovar crea una fila NUEVA, no mueve la fecha de la existente: así queda historial de
   * períodos y "cliente con múltiples suscripciones" deja de ser un caso borde.
   */
  async renovar(id: string, input: { precio?: number; medio?: 'EFECTIVO' | 'TRANSFERENCIA' }, adminId: string | null) {
    const anterior = await suscripcionRepo.findById(id);
    if (!anterior) throw NotFound('Suscripción', id);
    const hoy = hoyEnTz(getEnv().TZ_NEGOCIO);
    const inicio = inicioRenovacion(deFechaUtc(anterior.vencimiento), hoy);
    return suscripcionService.crear(
      { clienteId: anterior.clienteId, inicio, vencimiento: sumarUnMes(inicio), precio: input.precio, medio: input.medio },
      adminId,
    );
  },

  /** Cancelar NO recalcula las reservas ya bonificadas: la bonificación se congela al reservar. */
  async cancelar(id: string) {
    const s = await suscripcionRepo.findById(id);
    if (!s) throw NotFound('Suscripción', id);
    return suscripcionRepo.cancelar(id);
  },

  async listar() {
    const hoy = hoyEnTz(getEnv().TZ_NEGOCIO);
    const filas = await suscripcionRepo.list();
    const conteos = await suscripcionRepo.contarReservasPorSuscripcion(filas.map((s) => s.id));
    return filas.map((s) => ({
      id: s.id,
      clienteId: s.clienteId,
      cliente: { id: s.cliente.id, nombre: s.cliente.nombre, whatsapp: s.cliente.whatsapp },
      inicio: deFechaUtc(s.inicio),
      vencimiento: deFechaUtc(s.vencimiento),
      estado: s.estado,
      estadoVista: estadoVista(s, hoy),
      precio: s.precio == null ? null : Number(s.precio),
      nota: s.nota,
      turnosBonificados: conteos.get(s.id) ?? 0,
      creadoEn: s.creadoEn,
    }));
  },
};
