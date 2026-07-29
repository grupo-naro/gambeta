export { EstadoReserva, EstadoPago, VerificadoPor } from '../db/client.js';

export type Rol = 'ADMIN' | 'RECEPCIONISTA';

export type AuthPrincipal =
  | { kind: 'admin'; adminId: string; email: string; rol: Rol }
  | { kind: 'service' };
