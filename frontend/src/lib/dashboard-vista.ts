/** El dashboard tiene tres vistas: las canchas (fútbol y pádel), el buffet y la academia. */
export type VistaDashboard = 'canchas' | 'buffet' | 'academia';

/** Cualquier valor raro de la URL cae en la vista de canchas, que es la de siempre. */
export function normalizarVista(v: string | undefined): VistaDashboard {
  return v === 'buffet' || v === 'academia' ? v : 'canchas';
}

/**
 * Link del dashboard conservando el período al cambiar de vista (y la vista al cambiar de período).
 * Con `periodo: 'fecha'` lleva también las fechas elegidas (`desde`, y `hasta` si es un rango).
 */
export function dashboardHref({ periodo, vista, desde, hasta }: { periodo: string; vista: VistaDashboard; desde?: string; hasta?: string }): string {
  let href = `/dashboard?periodo=${encodeURIComponent(periodo)}&vista=${vista}`;
  if (periodo === 'fecha' && desde) {
    href += `&desde=${encodeURIComponent(desde)}`;
    if (hasta && hasta !== desde) href += `&hasta=${encodeURIComponent(hasta)}`;
  }
  return href;
}
