// Cookies propias del sitio de reservas. Todas first-party, sin datos personales: no se
// guarda ni IP ni user-agent, sólo identificadores opacos que genera este mismo server.
export const COOKIE_VISITANTE = 'gb_vid';
export const COOKIE_SESION = 'gb_sid';
export const COOKIE_ORIGEN = 'gb_org';

/** Cuánto dura la atribución del origen a una reserva (last-touch). */
export const DIAS_ORIGEN = 30;
/** Una sesión es una visita: quien recarga tres veces en media hora cuenta una. */
export const MINUTOS_SESION = 30;
/**
 * Ventana en la que la cookie de origen se considera "de esta llegada". El redirect de
 * /r/<etiqueta> a / y el montaje del beacon tardan segundos; 5 minutos es pura holgura.
 */
export const MINUTOS_ORIGEN_FRESCO = 5;

const ETIQUETA_RE = /^[a-z0-9-]{1,40}$/;

export function esEtiquetaValida(v: string): boolean {
  return ETIQUETA_RE.test(v);
}

/** Valor de `gb_org`: `<etiqueta>.<epochMs>`. El timestamp es lo que permite las dos lecturas. */
export function serializarOrigen(etiqueta: string, ahora: number): string {
  return `${etiqueta}.${ahora}`;
}

function parsear(valor: string | undefined): { etiqueta: string; puestoEn: number } | null {
  if (!valor) return null;
  // `lastIndexOf` y no `split`: la etiqueta puede tener guiones, pero nunca un punto.
  const i = valor.lastIndexOf('.');
  if (i <= 0) return null;
  const etiqueta = valor.slice(0, i);
  const puestoEn = Number(valor.slice(i + 1));
  if (!esEtiquetaValida(etiqueta) || !Number.isFinite(puestoEn)) return null;
  return { etiqueta, puestoEn };
}

/**
 * Etiqueta con la que se registra una VISITA. Sólo vale si la cookie se escribió recién, o
 * sea en esta llegada. Sin esta regla, alguien que entró una vez por el QR y después escribe
 * la URL a mano seguiría contando como QR durante 30 días, y el conteo por canal mentiría.
 */
export function etiquetaDeVisita(valor: string | undefined, ahora: number): string | null {
  const o = parsear(valor);
  if (!o) return null;
  const transcurrido = ahora - o.puestoEn;
  if (transcurrido < 0 || transcurrido > MINUTOS_ORIGEN_FRESCO * 60_000) return null;
  return o.etiqueta;
}

// Las dos lecturas de gb_org son asimétricas a propósito, y esa asimetría tiene una
// consecuencia diferida que conviene dejar escrita acá para que no se lea como un bug: contar
// UNA VISITA exige que la cookie sea de esta llegada (ventana de 5 minutos), pero ATRIBUIR UNA
// RESERVA vale toda la vida de la cookie (last-touch, 30 días). El día que el panel muestre
// "cuántos reservaron" por etiqueta, las reservas atribuidas a un link en un período pueden
// SUPERAR a las visitas de ese link en el mismo período: una reserva de hoy puede atribuirse a
// un link tocado hace 29 días, que ya no aparece entre las visitas "recientes". Eso no es un
// error de agregación — es exactamente lo que las dos ventanas distintas están diseñadas para
// producir. "Arreglarlo" igualando las dos ventanas rompería una de las dos semánticas.
/** Etiqueta con la que se ATRIBUYE una reserva: vale toda la vida de la cookie (last-touch). */
export function etiquetaDeReserva(valor: string | undefined): string | null {
  return parsear(valor)?.etiqueta ?? null;
}
