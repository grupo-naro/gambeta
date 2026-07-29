import { apiFetch } from '@/lib/api';
import type { Cancha, CajaReporte, AgendaDia, Config } from '@/lib/types';
import { hoyAR } from '@/lib/fecha';
import { AgendaHoy } from '@/components/hoy/agenda-hoy';

export default async function HoyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const fecha = sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) ? sp.fecha : hoyAR();

  const [canchas, agenda, caja, config] = await Promise.all([
    apiFetch<Cancha[]>('/canchas'),
    apiFetch<AgendaDia>(`/agenda?fecha=${fecha}`),
    apiFetch<CajaReporte>(`/caja?desde=${fecha}&hasta=${fecha}`),
    apiFetch<Config>('/config'),
  ]);

  return <AgendaHoy agenda={agenda} canchas={canchas} fecha={fecha} totalCobrado={caja.total} porMedio={caja.porMedio} senaMontoFijo={Number(config.senaMontoFijo)} />;
}
