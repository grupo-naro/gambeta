'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setPinBuffet, setActivoMostrador } from '@/lib/buffet-admin-actions';
import type { MostradorAdmin } from '@/lib/types';

function FilaMostrador({ m }: { m: MostradorAdmin }) {
  const [pin, setPin] = useState('');
  const [pending, start] = useTransition();

  function guardarPin() {
    if (!/^\d{4}$/.test(pin)) { toast.error('El PIN debe tener exactamente 4 dígitos'); return; }
    start(async () => {
      const r = await setPinBuffet(m.id, pin);
      if (r.ok) { toast.success(`PIN de ${m.nombre} actualizado`); setPin(''); }
      else toast.error(r.error);
    });
  }

  function alternarActivo() {
    start(async () => {
      const r = await setActivoMostrador(m.id, !m.activo);
      if (r.ok) toast.success(m.activo ? `${m.nombre} desactivado` : `${m.nombre} activado`);
      else toast.error(r.error);
    });
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">
            {m.nombre}{' '}
            <span className="text-xs font-normal uppercase text-neutral-500">{m.tipo}</span>
          </p>
          {!m.tienePin ? (
            // Es la explicación que hoy falta: el secundario nace sin PIN y con eso no entra
            // nadie, sin que ninguna pantalla lo diga.
            <p className="text-sm text-amber-700">Sin PIN cargado — nadie puede entrar a este puesto.</p>
          ) : (
            <p className="text-sm text-neutral-600">PIN cargado.</p>
          )}
          {!m.activo && (
            <p className="text-sm text-red-700">Desactivado — sus dispositivos no pueden operar.</p>
          )}
        </div>
        <Button variant="outline" onClick={alternarActivo} disabled={pending}>
          {m.activo ? 'Desactivar' : 'Activar'}
        </Button>
      </div>

      <div className="mt-3 flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`pin-${m.id}`}>PIN (4 dígitos)</Label>
          <Input
            id={`pin-${m.id}`}
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="0000"
            className="w-24"
          />
        </div>
        <Button onClick={guardarPin} disabled={pending}>
          {pending ? 'Guardando…' : m.tienePin ? 'Cambiar PIN' : 'Cargar PIN'}
        </Button>
      </div>
    </div>
  );
}

export function MostradoresPanel({ mostradores }: { mostradores: MostradorAdmin[] }) {
  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="font-medium">Mostradores</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Cada puesto entra con su propio PIN. Cambiar el PIN no cierra las sesiones ya abiertas:
        para eso, desactivá el mostrador.
      </p>
      <div className="mt-3 space-y-3">
        {mostradores.map((m) => <FilaMostrador key={m.id} m={m} />)}
      </div>
    </section>
  );
}
