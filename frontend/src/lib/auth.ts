'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { TOKEN_COOKIE } from './api';
import { loginSchema } from './validators';
import type { LoginResult } from './types';

const MAX_AGE = 60 * 60 * 24 * 365; // 1 año, matches backend JWT_EXPIRES_IN

export async function login(_prev: unknown, formData: FormData): Promise<{ error: string } | void> {
  const parsed = loginSchema.safeParse({
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, password } = parsed.data;
  const base = process.env.API_URL;
  if (!base) return { error: 'Configuración inválida: falta API_URL en el servidor' };
  let token: string;
  const destino = '/hoy';
  try {
    const res = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (body?.error?.code === 'USUARIO_VENCIDO') return { error: 'Usuario vencido' };
      return { error: 'Credenciales inválidas' };
    }
    const data = (await res.json()) as LoginResult;
    token = data.token;
  } catch {
    return { error: 'No se pudo conectar con el servidor' };
  }
  (await cookies()).set(TOKEN_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', path: '/', maxAge: MAX_AGE,
  });
  redirect(destino);
}

export async function logout(): Promise<void> {
  (await cookies()).delete(TOKEN_COOKIE);
  redirect('/login');
}
