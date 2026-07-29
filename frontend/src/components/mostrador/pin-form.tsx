'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { verificarPin } from '@/lib/buffet-actions';

export function PinForm() {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function enviar(valor: string) {
    setCargando(true);
    setError('');
    const r = await verificarPin(valor);
    setCargando(false);
    if (r.ok) router.replace('/mostrador');
    else { setError('PIN incorrecto'); setPin(''); }
  }

  function tecla(d: string) {
    if (cargando) return;
    const siguiente = (pin + d).slice(0, 4);
    setPin(siguiente);
    if (siguiente.length === 4) void enviar(siguiente);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-3xl font-semibold">Buffet</h1>

      <div className="flex gap-3" aria-label="PIN ingresado">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-5 w-5 rounded-full border-2 ${i < pin.length ? 'bg-neutral-900 border-neutral-900' : 'border-neutral-300'}`} />
        ))}
      </div>

      {error && <p className="text-lg font-medium text-red-600">{error}</p>}

      <div className="grid w-full grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => tecla(d)} disabled={cargando}
            className="h-20 rounded-2xl border border-neutral-300 bg-white text-3xl font-semibold active:scale-95 disabled:opacity-50">
            {d}
          </button>
        ))}
        <button type="button" onClick={() => setPin('')} disabled={cargando}
          className="h-20 rounded-2xl border border-neutral-300 bg-white text-lg font-medium active:scale-95">
          Borrar
        </button>
        <button type="button" onClick={() => tecla('0')} disabled={cargando}
          className="h-20 rounded-2xl border border-neutral-300 bg-white text-3xl font-semibold active:scale-95 disabled:opacity-50">
          0
        </button>
      </div>
    </div>
  );
}
