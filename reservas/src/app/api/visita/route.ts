import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse, after } from 'next/server';
import { apiReservas } from '@/lib/api';
import {
  COOKIE_ORIGEN, COOKIE_SESION, COOKIE_VISITANTE, DIAS_ORIGEN, MINUTOS_SESION, etiquetaDeVisita,
} from '@/lib/origen';

const ANIO_EN_SEG = 365 * 24 * 60 * 60;

/**
 * El único lugar que registra una visita. Lo llama el beacon del navegador, nunca un bot:
 * las previsualizaciones de links y los crawlers no ejecutan JavaScript.
 */
export async function POST(req: Request) {
  // Guard de mismo origen: sólo se rechaza si la cabecera está presente y NO dice
  // "same-origin". Los navegadores modernos siempre la mandan, así que esto frena un loop de
  // curl sin cookies (que hoy insertaría una fila por request, cada una con su propio
  // sesionId, sin que la deduplicación por sesión proteja nada) y protege al rate limiter del
  // backend, que ve la misma IP de egreso que usan la grilla y el alta de reservas. Rechazar
  // por AUSENCIA de la cabecera perdería visitas de navegadores viejos que no la mandan, y eso
  // es peor que el ruido que estamos evitando.
  const secFetchSite = req.headers.get('sec-fetch-site');
  if (secFetchSite && secFetchSite !== 'same-origin') {
    return new NextResponse(null, { status: 204 });
  }

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

  const etiqueta = etiquetaDeVisita(jar.get(COOKIE_ORIGEN)?.value, Date.now());
  const sesionVigente = jar.get(COOKIE_SESION)?.value;
  // Una llegada por link abre sesión nueva aunque la anterior siga viva: si no, el canal que
  // trajo a la persona queda absorbido por la sesión anterior y se acredita a DIRECTO. Es el
  // caso del bot de WhatsApp: alguien entra a mano, le queda gb_sid vigente, y minutos después
  // el bot le manda el link — esa llegada tiene que contarse.
  const sesionId = etiqueta ? randomUUID() : (sesionVigente ?? randomUUID());
  res.cookies.set(COOKIE_SESION, sesionId, { ...base, maxAge: MINUTOS_SESION * 60 });
  // Sesión vigente y sin etiqueta fresca: esta visita ya se contó (o es una recarga dentro de
  // la misma sesión), sólo se renueva la ventana de 30 minutos y se corta acá.
  if (!etiqueta && sesionVigente) return res;

  let referer: string | null = null;
  try {
    const body = (await req.json()) as { referer?: unknown };
    // Sólo se guarda el hostname, nunca la URL completa: el referer puede traer querystring
    // del sitio de origen, y hoy no se usa en ningún lado (ni se agrupa ni se renderiza) —
    // guardar más de lo que hace falta va contra el "sin datos personales" del diseño. El
    // valor viene del cliente y puede no ser una URL válida, de ahí el try/catch.
    if (typeof body.referer === 'string' && body.referer) {
      try { referer = new URL(body.referer).hostname; } catch { referer = null; }
    }
  } catch {
    // Body vacío o mal formado: el referer es opcional, seguimos sin él.
  }

  // Se quema la frescura de gb_org conservando la atribución: timestamp 0 hace que
  // `etiquetaDeVisita` la vea vieja (recargar dentro de los 5 minutos no cuenta una segunda
  // visita), pero `etiquetaDeReserva` la sigue leyendo — la atribución last-touch de 30 días
  // no se pierde. Se setea sobre `res`, no dentro de `after`: las cookies tienen que salir con
  // esta misma respuesta.
  if (etiqueta) {
    res.cookies.set(COOKIE_ORIGEN, `${etiqueta}.0`, { ...base, maxAge: DIAS_ORIGEN * 24 * 60 * 60 });
  }

  // El registro en el backend corre después de que la respuesta (y sus Set-Cookie) ya salió.
  // Si esperáramos el `await` acá, un backend lento o un corte de red dejarían al navegador
  // sin las cookies, el beacon se reintentaría en la siguiente carga con un sesionId nuevo, y
  // si el INSERT anterior sí había llegado, la visita quedaría contada dos veces como dos
  // visitantes distintos. Un backend degradado no tiene que inflar las estadísticas.
  after(async () => {
    try {
      await apiReservas('/visitas', {
        method: 'POST',
        body: JSON.stringify({ etiqueta, sesionId, visitanteId, referer }),
      });
    } catch (e) {
      // Una estadística que no se pudo guardar no puede romperle la pantalla a nadie.
      console.error('[visita] no se pudo registrar', { error: e instanceof Error ? e.message : e });
    }
  });

  return res;
}
