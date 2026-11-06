'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useConfirm } from '@/components/ui/confirm';
import { fijarPinDashboard, quitarPinDashboard } from '@/lib/dashboard-lock';
import { errorDePinNuevo } from '@/lib/pin-dashboard';

const soloNumeros = (v: string) => v.replace(/\D/g, '').slice(0, 8);

/** PIN para ver los números del dashboard. Con PIN, el dashboard arranca oculto. */
export function PinDashboard({ configurado }: { configurado: boolean }) {
  const [actual, setActual] = useState('');
  const [nuevo, setNuevo] = useState('');
  const [repetido, setRepetido] = useState('');
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  function limpiar() { setActual(''); setNuevo(''); setRepetido(''); }

  function guardar() {
    const err = errorDePinNuevo(nuevo, repetido);
    if (err) { toast.error(err); return; }
    if (configurado && !actual) { toast.error('Ingresá el PIN actual'); return; }
    start(async () => {
      const r = await fijarPinDashboard(nuevo, actual);
      if (r.ok) { toast.success(configurado ? 'PIN cambiado' : 'PIN puesto: el dashboard ahora arranca oculto'); limpiar(); }
      else toast.error(r.error);
    });
  }

  async function quitar() {
    if (!actual) { toast.error('Ingresá el PIN actual para quitarlo'); return; }
    const ok = await confirm({
      title: '¿Quitar el PIN?',
      description: 'El dashboard va a mostrar los números sin pedir nada.',
      confirmLabel: 'Quitar PIN', destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await quitarPinDashboard(actual);
      if (r.ok) { toast.success('PIN quitado'); limpiar(); } else toast.error(r.error);
    });
  }

  return (
    <Card id="pin-dashboard">
      <CardHeader>
        <CardTitle>PIN del dashboard</CardTitle>
        <p className="text-sm text-neutral-600">
          {configurado
            ? 'El dashboard está protegido: arranca con los números ocultos y pide el PIN para verlos (se vuelve a bloquear a los 15 minutos).'
            : 'Poné un PIN para que los números del dashboard queden ocultos y solo se vean ingresándolo, como en las apps de los bancos.'}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {configurado && (
          <div className="space-y-1">
            <Label htmlFor="pin-actual">PIN actual</Label>
            <Input id="pin-actual" type="password" inputMode="numeric" autoComplete="off" value={actual} onChange={(e) => setActual(soloNumeros(e.target.value))} className="max-w-xs" />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="pin-nuevo">{configurado ? 'PIN nuevo' : 'PIN'} (4 a 8 números)</Label>
            <Input id="pin-nuevo" type="password" inputMode="numeric" autoComplete="off" value={nuevo} onChange={(e) => setNuevo(soloNumeros(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pin-repetido">Repetir PIN</Label>
            <Input id="pin-repetido" type="password" inputMode="numeric" autoComplete="off" value={repetido} onChange={(e) => setRepetido(soloNumeros(e.target.value))} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={guardar}>{configurado ? 'Cambiar PIN' : 'Poner PIN'}</Button>
          {configurado && <Button type="button" variant="outline" disabled={pending} onClick={() => void quitar()}>Quitar PIN</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
