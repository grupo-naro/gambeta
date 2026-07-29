import { NextResponse, type NextRequest } from 'next/server';

// Keep in sync with TOKEN_COOKIE in src/lib/api.ts (middleware can't import the
// server-only api module, so the cookie name is intentionally duplicated here).
const TOKEN_COOKIE = 'token';

// Lee el payload del JWT (base64url, sin verificar firma — el backend es el guardia
// real) y decide si la sesión es usable para gatear las redirecciones. Un token
// vencido o sin `rol` (sesiones viejas tras el deploy de roles) cuenta como deslogueado,
// así evitamos el loop /dashboard ↔ /login con una cookie stale.
function tokenUsable(token: string): boolean {
  try {
    const part = token.split('.')[1];
    if (!part) return false;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { exp?: number; rol?: string };
    if (!payload.rol) return false;
    if (payload.exp && payload.exp * 1000 < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  // El mostrador del buffet no usa el login de admin: se gatea con su propio PIN
  // dentro de la ruta (ver src/lib/buffet-session.ts). Sin este early-return, el
  // middleware lo mandaría a /login y la pantalla sería inalcanzable.
  if (req.nextUrl.pathname.startsWith('/mostrador')) return NextResponse.next();

  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  const ok = !!token && tokenUsable(token);
  const { pathname } = req.nextUrl;
  const isLogin = pathname === '/login';

  if (!ok && !isLogin) {
    // Sesión inválida/ausente: a login y borramos la cookie stale (corta el loop).
    const res = NextResponse.redirect(new URL('/login', req.url));
    if (token) res.cookies.delete(TOKEN_COOKIE);
    return res;
  }
  if (ok && isLogin) return NextResponse.redirect(new URL('/dashboard', req.url));
  if (pathname === '/') return NextResponse.redirect(new URL(ok ? '/dashboard' : '/login', req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.).*)'],
};
