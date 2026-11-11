'use client';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { dashboardHref, type VistaDashboard } from '@/lib/dashboard-vista';

const OPCIONES: { v: VistaDashboard; label: string }[] = [
  { v: 'canchas', label: 'Canchas' },
  { v: 'buffet', label: 'Buffet' },
  { v: 'academia', label: 'Academia' },
];

/** Cambia entre las analíticas de las canchas (fútbol y pádel), el buffet y la academia, sin perder el período. */
export function VistaSelector({ vista, periodo, desde, hasta }: { vista: VistaDashboard; periodo: string; desde?: string; hasta?: string }) {
  const router = useRouter();
  return (
    <div className="inline-flex rounded-xl border bg-white p-1 shadow-sm" role="tablist" aria-label="Vista del dashboard">
      {OPCIONES.map((o) => (
        <button
          key={o.v}
          type="button"
          role="tab"
          aria-selected={vista === o.v}
          onClick={() => router.push(dashboardHref({ periodo, vista: o.v, desde, hasta }))}
          className={cn('rounded-lg px-6 py-2 text-base font-medium transition', vista === o.v ? 'bg-primary text-primary-foreground' : 'text-neutral-600 hover:bg-neutral-100')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
