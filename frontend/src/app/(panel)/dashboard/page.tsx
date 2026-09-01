import { DollarSign, CalendarDays, Trophy, Eye, Users } from 'lucide-react';
import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { Reserva, Cancha, Config, IngresoDia, OcupacionCelda, HorarioPico, Origenes } from '@/lib/types';
import { hoyAR, addDias } from '@/lib/fecha';
import { cierreMin } from '@/lib/hora';
import { MetricCard } from '@/components/dashboard/metric-card';
import { HorariosChart } from '@/components/dashboard/horarios-chart';
import { IngresosChart } from '@/components/dashboard/ingresos-chart';
import { OcupacionHeatmap } from '@/components/dashboard/ocupacion-heatmap';
import { PeriodoSelector } from '@/components/dashboard/periodo-selector';
import { OrigenesChart } from '@/components/dashboard/origenes-chart';
import { OrigenesTabla } from '@/components/dashboard/origenes-tabla';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> { try { return await p; } catch { return fallback; } }

const PERIODOS: Record<string, number> = { hoy: 0, '7': 6, '30': 29 };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const periodo = sp.periodo && sp.periodo in PERIODOS ? sp.periodo : '30';
  const hasta = hoyAR();
  const desde = addDias(hasta, -PERIODOS[periodo]);
  const qs = `desde=${desde}&hasta=${hasta}`;

  const [ingresos, reservas, canchasTop, canchas, horarios, ingresosDia, ocupacion, config, origenes] = await Promise.all([
    safe(apiFetch<{ total: number }>(`/analytics/ingresos?${qs}`), { total: 0 }),
    safe(apiFetch<Reserva[]>(`/reservas?${qs}`), []),
    safe(apiFetch<{ canchaId: string; reservas: number }[]>(`/analytics/canchas-top?${qs}`), []),
    safe(apiFetch<Cancha[]>('/canchas'), []),
    safe(apiFetch<HorarioPico[]>(`/analytics/horarios-pico?${qs}`), []),
    safe(apiFetch<IngresoDia[]>(`/analytics/ingresos-por-dia?${qs}`), []),
    safe(apiFetch<OcupacionCelda[]>(`/analytics/ocupacion?${qs}`), []),
    safe(apiFetch<Config>('/config'), { horaApertura: '09:00', horaCierre: '23:00', horaAperturaFinde: '16:00', horaCierreFinde: '00:00' } as Config),
    safe(apiFetch<Origenes>(`/analytics/origenes?${qs}`), { total: 0, unicos: 0, porTipo: [], porEtiqueta: [] }),
  ]);

  const topNombre = canchasTop[0] ? (canchas.find((c) => c.id === canchasTop[0].canchaId)?.nombre ?? '—') : '—';
  const horariosData = horarios.map((h) => ({ hora: `${h.hora}:00`, reservas: Number(h.reservas) })).sort((a, b) => parseInt(a.hora) - parseInt(b.hora));
  const ingresosData = [...ingresosDia].sort((a, b) => a.fecha.localeCompare(b.fecha)).map((d) => ({ fecha: d.fecha, total: Number(d.total) }));

  const aperturaU = Number(config.horaApertura.slice(0, 2)) <= Number(config.horaAperturaFinde.slice(0, 2)) ? config.horaApertura : config.horaAperturaFinde;
  const cierreU = cierreMin(config.horaCierre) >= cierreMin(config.horaCierreFinde) ? config.horaCierre : config.horaCierreFinde;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-neutral-600">Resumen del complejo.</p>
        </div>
        <PeriodoSelector periodo={periodo} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard title="Ingresos del período" value={money(ingresos.total)} hint="Reservas confirmadas/completadas" Icon={DollarSign} />
        <MetricCard title="Reservas del período" value={String(reservas.length)} Icon={CalendarDays} />
        <MetricCard title="Cancha más reservada" value={topNombre} Icon={Trophy} />
      </div>
      <IngresosChart data={ingresosData} />
      <div className="grid gap-4 lg:grid-cols-2">
        <HorariosChart data={horariosData} />
        <OcupacionHeatmap data={ocupacion} horaApertura={aperturaU} horaCierre={cierreU} />
      </div>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <MetricCard title="Visitas al sitio" value={String(origenes.total)} hint="Sesiones en la web de reservas" Icon={Eye} />
          <MetricCard title="Personas distintas" value={String(origenes.unicos)} Icon={Users} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <OrigenesChart data={origenes.porTipo} />
          <OrigenesTabla data={origenes.porEtiqueta} />
        </div>
      </div>
    </div>
  );
}
