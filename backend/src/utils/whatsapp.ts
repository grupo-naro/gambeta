/**
 * Normaliza un whatsapp argentino al JID del bot: "549" + 10 dígitos locales (área + número).
 * Devuelve null si no se puede resolver. Ignora +, espacios, guiones, paréntesis.
 * Idempotente: normalizarWhatsapp('5491136620274') === '5491136620274'.
 */
export function normalizarWhatsapp(raw: string): string | null {
  let d = (raw ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2); // salida internacional
  if (d.startsWith('0')) d = d.slice(1);  // 0 troncal
  if (d.length === 13 && d.startsWith('549')) return d;        // ya canónico
  if (d.length === 12 && d.startsWith('54')) return '549' + d.slice(2); // 54 + local (sin 9)
  if (d.length === 10) return '549' + d;                       // local pelado
  return null;
}
