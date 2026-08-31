import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { apiReservas } from '@/lib/api';
import {
  COOKIE_ORIGEN, COOKIE_SESION, COOKIE_VISITANTE, MINUTOS_SESION, etiquetaDeVisita,
} from '@/lib/origen';

const ANIO_EN_SEG = 365 * 24 * 60 * 60;

/**
 * El único lugar que registra una visita. Lo llama el beacon del navegador, nunca un bot:
 * las previsualizaciones de links y los crawlers no ejecutan JavaScript.
 */
export async function POST(req: Request) {
  const jar = await cookies();
  const res = new NextResponse(null, { status: 204 });
  const base = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };

  const visitanteId = jar.get(COOKIE_VISITANTE)?.value ?? randomUUID();
  res.cookies.set(COOKIE_VISITANTE, visitanteId, { ...base, maxAge: ANIO_EN_SEG });

  // La cookie de sesión expira sola a los 30 minutos: que exista significa que esta visita ya
  // se contó, así que sólo se le renueva la ventana y se corta acá. Es lo que hace que quien
  // recarga o navega entre pantallas cuente una vez.
  const sesionVigente = jar.get(COOKIE_SESION)?.value;
  const sesionId = sesionVigente ?? randomUUID();
  res.cookies.set(COOKIE_SESION, sesionId, { ...base, maxAge: MINUTOS_SESION * 60 });
  if (sesionVigente) return res;

  let referer: string | null = null;
  try {
    const body = (await req.json()) as { referer?: unknown };
    if (typeof body.referer === 'string' && body.referer) referer = body.referer.slice(0, 500);
  } catch {
    // Body vacío o mal formado: el referer es opcional, seguimos sin él.
  }

  try {
    await apiReservas('/visitas', {
      method: 'POST',
      body: JSON.stringify({
        etiqueta: etiquetaDeVisita(jar.get(COOKIE_ORIGEN)?.value, Date.now()),
        sesionId,
        visitanteId,
        referer,
      }),
    });
  } catch (e) {
    // Una estadística que no se pudo guardar no puede romperle la pantalla a nadie.
    console.error('[visita] no se pudo registrar', { error: e instanceof Error ? e.message : e });
  }

  return res;
}
