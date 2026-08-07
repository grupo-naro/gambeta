'use client';
import { useEffect, useTransition } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import type { CuentaMp } from '@/lib/types';
import { vincularMp, desvincularMp } from '@/lib/mercadopago-actions';
import { diasHasta } from '@/lib/fecha';

/** Resultado de la vuelta desde Mercado Pago, comunicado por query param (?mp=ok|error) desde la página de callback. */
export function CuentaMercadoPago({ cuenta, resultado }: { cuenta: CuentaMp; resultado?: 'ok' | 'error' }) {
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!resultado) return;
    if (resultado === 'ok') toast.success('Cuenta de Mercado Pago vinculada');
    else toast.error('No se pudo vincular la cuenta de Mercado Pago');
    router.replace(pathname);
  }, [resultado, router, pathname]);

  function vincular() {
    start(async () => {
      const r = await vincularMp();
      if (r.ok) window.location.href = r.url;
      else toast.error(r.error);
    });
  }

  async function desvincular() {
    const ok = await confirm({
      title: '¿Desvincular Mercado Pago?',
      description: 'Se cortan los cobros online: la web deja de tomar reservas hasta que vuelvas a vincular la cuenta.',
      confirmLabel: 'Desvincular',
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await desvincularMp();
      if (r.ok) toast.success('Cuenta desvinculada');
      else toast.error(r.error);
    });
  }

  if (!cuenta.vinculada) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Mercado Pago</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-neutral-600">Sin una cuenta de Mercado Pago vinculada, la web no toma reservas con pago online.</p>
          <Button disabled={pending} onClick={vincular}>{pending ? 'Redirigiendo…' : 'Vincular Mercado Pago'}</Button>
        </CardContent>
      </Card>
    );
  }

  // Una cuenta caída significa que NO se está cobrando y que la web dejó de tomar reservas:
  // es plata que deja de entrar y el dueño puede no enterarse por días. Por eso lleva fondo y
  // borde de alarma en vez de solo texto en rojo — mismo tratamiento que el aviso de stock bajo
  // del buffet, que avisa de algo bastante menos grave.
  if (cuenta.caida) {
    return (
      <Card className="bg-red-50 ring-1 ring-inset ring-red-600/20">
        <CardHeader><CardTitle className="text-base text-red-900">Mercado Pago · se cortaron los cobros</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-red-800">
            Se perdió la conexión con Mercado Pago{cuenta.apodo ? ` (${cuenta.apodo})` : ''}. <strong>La web no está tomando reservas online.</strong> Volvé a vincular la cuenta para reanudar los cobros.
          </p>
          <Button disabled={pending} onClick={vincular}>{pending ? 'Redirigiendo…' : 'Volver a vincular'}</Button>
        </CardContent>
      </Card>
    );
  }

  const dias = cuenta.venceEn ? diasHasta(cuenta.venceEn) : null;
  const porVencer = dias !== null && dias < 14;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Mercado Pago</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          Cuenta vinculada: <strong>{cuenta.apodo}</strong>
          {cuenta.venceEn && <> · vale hasta {new Date(cuenta.venceEn).toLocaleDateString('es-AR')}</>}
        </p>
        {porVencer && (
          <p className="text-amber-600">La vinculación vence pronto. Convendría revincularla para no cortar los cobros online.</p>
        )}
        <Button variant="destructive" disabled={pending} onClick={desvincular}>Desvincular</Button>
      </CardContent>
    </Card>
  );
}
