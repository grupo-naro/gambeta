import { NextResponse } from 'next/server';
import { COOKIE_ORIGEN, DIAS_ORIGEN, esEtiquetaValida, serializarOrigen } from '@/lib/origen';

/**
 * Punto de entrada de todos los links del complejo: /r/whatsapp, /r/ig-bio, /r/landing, y
 * el día que se impriman, /r/qr-entrada y compañía.
 *
 * Esta ruta SÓLO etiqueta y redirige — deliberadamente no escribe nada en la base. Cuando el
 * bot manda el link, WhatsApp hace su propio fetch de la página para armar la previsualización:
 * si registráramos la visita acá, contaríamos como visita algo que ninguna persona miró, y
 * justo en el canal que más interesa medir. El registro real lo dispara el navegador desde `/`.
 *
 * La etiqueta inválida no es un error para el visitante: llega igual a reservar, sólo que sin
 * quedar atribuida. Romperle la reserva a alguien por un link mal tipeado sería peor.
 */
export async function GET(req: Request, ctx: { params: Promise<{ etiqueta: string }> }) {
  const { etiqueta } = await ctx.params;
  const res = NextResponse.redirect(new URL('/', req.url), 302);
  if (esEtiquetaValida(etiqueta)) {
    res.cookies.set(COOKIE_ORIGEN, serializarOrigen(etiqueta, Date.now()), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: DIAS_ORIGEN * 24 * 60 * 60,
    });
  }
  return res;
}
