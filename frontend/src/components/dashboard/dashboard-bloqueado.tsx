'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { DollarSign, CalendarDays, Trophy, Eye, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { MetricCard } from './metric-card';
import { desbloquearDashboard } from '@/lib/dashboard-lock';

const OCULTO = '••••••';

/**
 * El dashboard cuando tiene PIN y todavía no se ingresó: los números están tapados (como el saldo
 * de una app de banco) y no se cargaron — el backend no los entrega sin el PIN.
 */
export function DashboardBloqueado() {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [pending, start] = useTransition();

  function ver(e: React.FormEvent) {
    e.preventDefault();
    if (!pin) return;
    start(async () => {
      const r = await desbloquearDashboard(pin);
      if (r.ok) { setPin(''); router.refresh(); }
      else { toast.error(r.error); setPin(''); }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-600">Resumen del complejo.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        <MetricCard title="Ingresos del período" value={OCULTO} Icon={DollarSign} />
        <MetricCard title="Reservas del período" value={OCULTO} Icon={CalendarDays} />
        <MetricCard title="Cancha más reservada" value={OCULTO} Icon={Trophy} />
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="h-6 w-6" />
          </span>
          <div>
            <p className="text-lg font-semibold">Los números están ocultos</p>
            <p className="mt-1 text-sm text-neutral-600">Ingresá el PIN para ver el dashboard.</p>
          </div>
          <form onSubmit={ver} className="flex w-full max-w-xs flex-col gap-3">
            <Input
              type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={8}
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="PIN" aria-label="PIN del dashboard" className="text-center text-lg tracking-widest"
            />
            <Button type="submit" disabled={pending || pin.length < 4}>
              <Eye className="mr-1 h-4 w-4" /> {pending ? 'Verificando…' : 'Ver números'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
