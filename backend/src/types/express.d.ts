import type { AuthPrincipal, MostradorSesion } from './domain.js';
declare global {
  namespace Express {
    interface Request {
      principal?: AuthPrincipal;
      mostrador?: MostradorSesion;
    }
  }
}
export {};
