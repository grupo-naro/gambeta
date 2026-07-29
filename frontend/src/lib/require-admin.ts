import { redirect } from 'next/navigation';
import { getSession } from './session';
import { ApiAuthError } from './types';

/** Server guard: exige ADMIN. Recepcionista → /reservas; sin sesión → /login. */
export async function requireAdmin(): Promise<void> {
  try {
    const s = await getSession();
    if (s.rol !== 'ADMIN') redirect('/reservas');
  } catch (e) {
    if (e instanceof ApiAuthError) redirect('/login');
    throw e;
  }
}
