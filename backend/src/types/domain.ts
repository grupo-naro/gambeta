export { EstadoReserva, EstadoPago, VerificadoPor } from '../db/client.js';
import type { TipoMostrador } from '../db/client.js';

export type Rol = 'ADMIN' | 'RECEPCIONISTA';

export type AuthPrincipal =
  | { kind: 'admin'; adminId: string; email: string; rol: Rol }
  | { kind: 'service' };

// Quién resultó identificado por authMostrador: el mostrador del buffet que está operando,
// resuelto a partir del token firmado en /pin/verificar. No reemplaza a AuthPrincipal (admin/
// servicio); conviven en la request porque authMostrador exige la x-buffet-key además del token.
export interface MostradorSesion {
  id: string;
  tipo: TipoMostrador;
}
