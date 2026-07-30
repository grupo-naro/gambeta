export interface CuotaParseada {
  ok: boolean;
  /** `null` = campo vacío, que es válido y significa "no registrar cobro". */
  monto: number | null;
}

/**
 * Parsea el monto de una cuota escrito por el admin.
 *
 * El campo vacío es válido: la suscripción se da de alta (o se renueva) sin registrar
 * ningún cobro, para cuando el complejo cobró la cuota por fuera del sistema.
 *
 * Un texto que no resuelve a un número finito y no negativo devuelve `ok: false`, para
 * que el diálogo avise en vez de mandar un monto basura al backend. Antes, un valor no
 * numérico caía en `NaN`, la condición `monto > 0` daba falso y la suscripción se creaba
 * en silencio sin el cobro que el admin creía haber cargado.
 */
export function parseCuota(texto: string): CuotaParseada {
  const limpio = texto.trim();
  if (limpio === '') return { ok: true, monto: null };
  const n = Number(limpio);
  if (!Number.isFinite(n) || n < 0) return { ok: false, monto: null };
  return { ok: true, monto: n };
}
