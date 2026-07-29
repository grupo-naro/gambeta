'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setPinBuffet } from '@/lib/buffet-admin-actions';

export function PinMostradorForm() {
  const [pin, setPin] = useState('');
  const [pending, start] = useTransition();

  function submit() {
    if (!/^\d{4}$/.test(pin)) { toast.error('El PIN debe tener exactamente 4 dígitos'); return; }
    start(async () => {
      const r = await setPinBuffet(pin);
      if (r.ok) { toast.success('PIN del mostrador actualizado'); setPin(''); }
      else toast.error(r.error);
    });
  }

  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="font-medium">PIN del mostrador</h2>
      <p className="mt-1 text-sm text-neutral-600">Es el PIN que se ingresa en la pantalla del mostrador.</p>
      <div className="mt-3 flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="pin-mostrador">PIN (4 dígitos)</Label>
          <Input
            id="pin-mostrador"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="0000"
            className="w-24"
          />
        </div>
        <Button onClick={submit} disabled={pending}>{pending ? 'Guardando…' : 'Guardar PIN'}</Button>
      </div>
    </section>
  );
}
