export const TIPOS = [
  { value: 'futbol', label: 'Fútbol' },
  { value: 'voley', label: 'Vóley' },
  { value: 'basquet', label: 'Básquet' },
  { value: 'padel', label: 'Pádel' },
  { value: 'tenis', label: 'Tenis' },
  { value: 'otro', label: 'Otro' },
] as const;

/** Tamaños de fútbol (cancha simple y divisible). */
export const TAMANOS_FUTBOL = [5, 6, 7, 9, 11] as const;

/** Centinela de "Otro" tamaño (canchas que no son de fútbol). */
export const OTRO_TAMANO = 0;

/** Mapea valores legacy de tipo (futbol, futbol5, futbol6, futbol7, futbol11, ...) al slug de deporte actual. */
export function normalizeTipo(raw: string): string {
  if (/^futbol\d*$/.test(raw)) return 'futbol';
  return TIPOS.some((t) => t.value === raw) ? raw : 'otro';
}

export function tipoLabel(value: string): string {
  return TIPOS.find((t) => t.value === normalizeTipo(value))?.label ?? 'Otro';
}

export function tamanoLabel(jugadores: number): string {
  return jugadores === OTRO_TAMANO ? 'Otro' : `Fútbol ${jugadores}`;
}
