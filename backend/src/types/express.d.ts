import type { AuthPrincipal } from './domain.js';
declare global {
  namespace Express {
    interface Request {
      principal?: AuthPrincipal;
    }
  }
}
export {};
