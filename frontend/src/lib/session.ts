import { apiFetch } from './api';
import type { Rol } from './types';

export interface Session { id: string; email: string; nombre: string; rol: Rol }

/** Lee la sesión actual desde el backend (GET /auth/me). Lanza ApiAuthError si no hay sesión. */
export async function getSession(): Promise<Session> {
  return apiFetch<Session>('/auth/me');
}
