import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

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
  tipo: 'PRINCIPAL' | 'SECUNDARIO';
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
    if (tipo !== 'PRINCIPAL' && tipo !== 'SECUNDARIO') return null;
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
export async function mostradorDeSesion(): Promise<{ nombre: string; tipo: 'PRINCIPAL' | 'SECUNDARIO' } | null> {
  const s = await sesionActual();
  return s ? { nombre: s.nombre, tipo: s.tipo } : null;
}

export async function sesionBuffetValida(): Promise<boolean> {
  return (await sesionActual()) !== null;
}

export async function requireSesionBuffet(): Promise<void> {
  if (!(await sesionBuffetValida())) throw new Error('Sesión de buffet inválida');
}
