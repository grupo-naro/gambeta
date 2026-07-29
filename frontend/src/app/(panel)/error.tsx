'use client';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight">Estamos en mantenimiento</h1>
        <p className="mt-2 text-sm text-neutral-600">En unas horas el sistema va a estar disponible. Probá de nuevo en un rato.</p>
        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={() => reset()}>Reintentar</Button>
          <a href="/hoy" className="text-sm text-neutral-600 underline-offset-4 hover:text-neutral-900 hover:underline">Volver al inicio</a>
        </div>
      </div>
    </div>
  );
}
