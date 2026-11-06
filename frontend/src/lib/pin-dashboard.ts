/** El PIN del dashboard: entre 4 y 8 dígitos (mismo criterio que el backend). */
export function pinValido(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

/** Qué hay que corregir antes de guardar un PIN nuevo; null si está bien. */
export function errorDePinNuevo(pin: string, repetido: string): string | null {
  if (!pinValido(pin)) return 'El PIN tiene que ser de 4 a 8 números';
  if (pin !== repetido) return 'Los dos PIN no coinciden';
  return null;
}
