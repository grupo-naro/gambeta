import { DollarSign, CalendarDays, Trophy, Eye, Users } from 'lucide-react';
import { requireAdmin } from '@/lib/require-admin';
import { apiFetch } from '@/lib/api';
import type { Cancha, Config, IngresoDia, OcupacionCelda, HorarioPico, Origenes, ReservasResumen } from '@/lib/types';
import { hoyAR, addDias } from '@/lib/fecha';
import { resolverAperturaCierreUnificados } from '@/lib/hora';
import { MetricCard } from '@/components/dashboard/metric-card';
import { HorariosChart } from '@/components/dashboard/horarios-chart';
import { IngresosChart } from '@/components/dashboard/ingresos-chart';
import { OcupacionHeatmap } from '@/components/dashboard/ocupacion-heatmap';
import { PeriodoSelector } from '@/components/dashboard/periodo-selector';
import { ReservasDetalle } from '@/components/dashboard/reservas-detalle';
import { DashboardBloqueado } from '@/components/dashboard/dashboard-bloqueado';
import { BotonOjo } from '@/components/dashboard/boton-ojo';
import { OrigenesChart } from '@/components/dashboard/origenes-chart';
import { OrigenesTabla } from '@/components/dashboard/origenes-tabla';

const money = (n: number) => '$' + Number(n || 0).toLocaleString('es-AR');
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> { try { return await p; } catch { return fallback; } }

const PERIODOS: Record<string, number> = { hoy: 0, '7': 6, '30': 29 };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  // Con PIN y sin desbloquear no se pide ningún dato: el backend los rechazaría igual, y así la
  // pantalla muestra el candado en vez de ceros.
  const lock = await safe(apiFetch<{ configurado: boolean; desbloqueado: boolean }>('/config/dashboard-pin/estado'), { configurado: false, desbloqueado: true });
  if (lock.configurado && !lock.desbloqueado) return <DashboardBloqueado />;
  const periodo = sp.periodo && (sp.periodo in PERIODOS || sp.periodo === 'mes' || sp.periodo === 'semana') ? sp.periodo : '30';
  const hasta = hoyAR();
  // "Este mes" arranca el día 1 (YYYY-MM-01); los demás son los últimos N días hasta hoy.
  // "Esta semana" arranca el lunes; "Este mes", el día 1; los demás son los últimos N días hasta hoy.
  const diaSemana = new Date(hasta + 'T00:00:00Z').getUTCDay(); // 0 = domingo
  const desde = periodo === 'mes' ? `${hasta.slice(0, 8)}01`
    : periodo === 'semana' ? addDias(hasta, -((diaSemana + 6) % 7))
    : addDias(hasta, -PERIODOS[periodo]);
  const qs = `desde=${desde}&hasta=${hasta}`;

  const [ingresos, reservas, canchasTop, canchas, horarios, ingresosDia, ocupacion, config, origenes] = await Promise.all([
    safe(apiFetch<{ total: number }>(`/analytics/ingresos?${qs}`), { total: 0 }),
    safe(apiFetch<ReservasResumen>(`/analytics/reservas?${qs}`), { total: 0, proximas: 0, canceladas: 0, esperandoSena: 0, porDeporte: { futbol: 0, padel: 0 }, porOrigen: { sueltas: 0, abonos: 0, socios: 0 } }),
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

  const { aperturaU, cierreU } = resolverAperturaCierreUnificados(config);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-neutral-600">Resumen del complejo.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodoSelector periodo={periodo} />
          <BotonOjo configurado={lock.configurado} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard title="Ingresos del período" value={money(ingresos.total)} hint="Reservas confirmadas/completadas" Icon={DollarSign} />
        <MetricCard title="Reservas del período" value={String(reservas.total)} hint="Turnos ya usados (terminó su horario)" Icon={CalendarDays} />
        <MetricCard title="Cancha más reservada" value={topNombre} Icon={Trophy} />
      </div>
      <ReservasDetalle r={reservas} />
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
