import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiAuthError, type TipoMostrador } from './types';

export const BUFFET_COOKIE = 'buffet';
const DIAS_30 = 30 * 24 * 60 * 60 * 1000;

// Reusamos BUFFET_API_KEY como clave HMAC: una env var menos que sincronizar
// entre Vercel y la VM, y nunca sale del servidor.
function secreto(): string {
  const s = process.env.BUFFET_API_KEY;
  if (!s) throw new Error('BUFFET_API_KEY no configurada');
  return s;
}

const firmar = (payload: string) => createHmac('sha256', secreto()).update(payload).digest('hex');

export interface SesionMostrador {
  /** El token que emitió el backend al verificar el PIN. Viaja en `x-mostrador`. */
  token: string;
  nombre: string;
  tipo: TipoMostrador;
}

/**
 * Formato: `base64url(JSON({exp, token})).<firma>`.
 *
 * El token del backend es `<mostradorId>.<firma>`, o sea que tiene un punto adentro: el
 * formato viejo (`exp.sig`) lo habría truncado al partirlo. Por eso el payload va codificado.
 *
 * La identidad del mostrador vive DENTRO de lo firmado: sin eso, cualquiera podría editar la
 * cookie para operar como el otro puesto, y toda la conciliación del cierre se apoya en que
 * "quién vendió" sea confiable.
 */
export function firmarSesion(expMs: number, sesion: SesionMostrador): string {
  const payload = Buffer.from(JSON.stringify({ exp: expMs, ...sesion })).toString('base64url');
  return `${payload}.${firmar(payload)}`;
}

/** Devuelve la sesión si la firma es válida y no venció; `null` en cualquier otro caso. */
export function leerSesion(valor: string | undefined): SesionMostrador | null {
  const partes = (valor ?? '').split('.');
  if (partes.length !== 2) return null;
  const [payload, sig] = partes;
  if (!payload || !sig) return null;

  const esperada = Buffer.from(firmar(payload));
  const dada = Buffer.from(sig);
  if (esperada.length !== dada.length) return null;
  if (!timingSafeEqual(esperada, dada)) return null;

  try {
    const { exp, token, nombre, tipo } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof exp !== 'number' || typeof token !== 'string' || !token) return null;
    if (tipo !== 'PRINCIPAL' && tipo !== 'SECUNDARIO' && tipo !== 'TERCERO') return null;
    if (exp <= Date.now()) return null;
    return { token, nombre: typeof nombre === 'string' ? nombre : '', tipo };
  } catch {
    return null;
  }
}

export async function crearSesionBuffet(sesion: SesionMostrador): Promise<void> {
  const jar = await cookies();
  jar.set(BUFFET_COOKIE, firmarSesion(Date.now() + DIAS_30, sesion), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    path: '/mostrador', maxAge: DIAS_30 / 1000,
  });
}

export async function borrarSesionBuffet(): Promise<void> {
  (await cookies()).delete({ name: BUFFET_COOKIE, path: '/mostrador' });
}

async function sesionActual(): Promise<SesionMostrador | null> {
  return leerSesion((await cookies()).get(BUFFET_COOKIE)?.value);
}

/** El token del mostrador logueado, para mandarlo en `x-mostrador`. */
export async function tokenMostradorDeSesion(): Promise<string | null> {
  return (await sesionActual())?.token ?? null;
}

/** Quién es el puesto logueado, para mostrarlo en la pantalla de venta. */
export async function mostradorDeSesion(): Promise<{ nombre: string; tipo: TipoMostrador } | null> {
  const s = await sesionActual();
  return s ? { nombre: s.nombre, tipo: s.tipo } : null;
}

export async function sesionBuffetValida(): Promise<boolean> {
  return (await sesionActual()) !== null;
}

export async function requireSesionBuffet(): Promise<void> {
  if (!(await sesionBuffetValida())) throw new Error('Sesión de buffet inválida');
}

/**
 * Si `e` es un 401 (`buffetFetch` ya lo distingue como `ApiAuthError`), manda al PIN con una
 * marca en la URL; para cualquier otro error, no hace nada y deja que el catch del caller lo
 * siga manejando (409, error.tsx genérico, etc).
 *
 * NO borra la cookie acá. Esto se llama desde el `catch` de un Server Component en fase de
 * render (`page.tsx`), y `cookies().delete()`/`.set()` solo se pueden usar en un Server
 * Function o Route Handler — llamarlos durante el render tira `ReadonlyRequestCookiesError`
 * ("The `.delete` method can only be called in a Server Function or Route Handler", ver
 * `frontend/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`).
 * Esa excepción reemplazaría al 401 que se quería manejar y terminaría en el mismo error.tsx
 * genérico de antes — el bug que este helper existe para evitar.
 *
 * Por eso la cookie vieja se deja vivir: es inútil (el backend la sigue rechazando con 401)
 * pero inofensiva. `pin/page.tsx` deja de confiar en `sesionBuffetValida()` cuando ve esta
 * marca, así no rebota de nuevo a `/mostrador`. Cuando el operador carga un PIN válido,
 * `verificarPin` — que sí es una Server Action — pisa la cookie vieja con `crearSesionBuffet`
 * sin problema.
 */
export async function manejarBuffetNoAutorizado(e: unknown): Promise<void> {
  if (!(e instanceof ApiAuthError)) return;
  redirect('/mostrador/pin?motivo=revocado');
}
