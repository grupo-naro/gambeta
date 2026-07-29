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

const firmar = (exp: string) => createHmac('sha256', secreto()).update(exp).digest('hex');

export function firmarToken(expMs: number): string {
  const exp = String(expMs);
  return `${exp}.${firmar(exp)}`;
}

export function tokenValido(token: string): boolean {
  const [exp, sig] = (token ?? '').split('.');
  if (!exp || !sig) return false;
  const esperada = Buffer.from(firmar(exp));
  const dada = Buffer.from(sig);
  if (esperada.length !== dada.length) return false;
  if (!timingSafeEqual(esperada, dada)) return false;
  return Number(exp) > Date.now();
}

export async function crearSesionBuffet(): Promise<void> {
  const jar = await cookies();
  jar.set(BUFFET_COOKIE, firmarToken(Date.now() + DIAS_30), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    path: '/mostrador', maxAge: DIAS_30 / 1000,
  });
}

export async function sesionBuffetValida(): Promise<boolean> {
  const t = (await cookies()).get(BUFFET_COOKIE)?.value;
  return !!t && tokenValido(t);
}

export async function requireSesionBuffet(): Promise<void> {
  if (!(await sesionBuffetValida())) throw new Error('Sesión de buffet inválida');
}
