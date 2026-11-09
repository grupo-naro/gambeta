/** El dashboard tiene dos vistas: las canchas (fútbol y pádel) y el buffet. */
export type VistaDashboard = 'canchas' | 'buffet';

/** Cualquier valor raro de la URL cae en la vista de canchas, que es la de siempre. */
export function normalizarVista(v: string | undefined): VistaDashboard {
  return v === 'buffet' ? 'buffet' : 'canchas';
}

/** Link del dashboard conservando el período al cambiar de vista (y la vista al cambiar de período). */
export function dashboardHref({ periodo, vista }: { periodo: string; vista: VistaDashboard }): string {
  return `/dashboard?periodo=${encodeURIComponent(periodo)}&vista=${vista}`;
}
