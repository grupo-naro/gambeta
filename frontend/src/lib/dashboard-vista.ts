/** El dashboard tiene tres vistas: las canchas (fútbol y pádel), el buffet y la academia. */
export type VistaDashboard = 'canchas' | 'buffet' | 'academia';

/** Cualquier valor raro de la URL cae en la vista de canchas, que es la de siempre. */
export function normalizarVista(v: string | undefined): VistaDashboard {
  return v === 'buffet' || v === 'academia' ? v : 'canchas';
}

/** Link del dashboard conservando el período al cambiar de vista (y la vista al cambiar de período). */
export function dashboardHref({ periodo, vista }: { periodo: string; vista: VistaDashboard }): string {
  return `/dashboard?periodo=${encodeURIComponent(periodo)}&vista=${vista}`;
}
