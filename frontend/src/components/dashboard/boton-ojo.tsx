'use client';
import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { bloquearDashboard } from '@/lib/dashboard-lock';

/**
 * El ojo del dashboard. Con PIN puesto, tapa los números al instante (para volver a verlos hay que
 * ingresar el PIN). Sin PIN, invita a ponerlo: ocultar sin poder proteger no serviría de nada.
 */
export function BotonOjo({ configurado }: { configurado: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (!configurado) {
    return (
      <Link href="/configuracion#pin-dashboard" className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100">
        <Eye className="h-4 w-4" /> Proteger con PIN
      </Link>
    );
  }
  return (
    <Button
      type="button" variant="outline" disabled={pending} aria-label="Ocultar los números del dashboard"
      onClick={() => start(async () => { await bloquearDashboard(); router.refresh(); })}
    >
      <EyeOff className="mr-1 h-4 w-4" /> Ocultar
    </Button>
  );
}
