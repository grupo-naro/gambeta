'use client';
import { Suspense, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { crearPreferenciaPago, getEstadoPago, getMetodosPago } from '@/lib/actions';
import { DatosTransferencia } from '@/components/datos-transferencia';
import type { EstadoPagoReserva, MetodosPago } from '@/lib/types';

export default function PagoPendientePage() {
  return (
    <Suspense fallback={null}>
      <PagoPendienteContenido />
    </Suspense>
  );
}

/** "Pádel 1 · jue 12/11 · 20:00" con la hora de Argentina. */
function resumenDe(e: EstadoPagoReserva): string {
  const f = new Date(e.fechaInicio);
  const dia = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short', day: '2-digit', month: '2-digit' }).format(f);
  const hora = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false }).format(f);
  return `${e.canchaNombre} · ${dia} · ${hora}`;
}

function PagoPendienteContenido() {
  const params = useSearchParams();
  const reservaId = params.get('external_reference');
  // Mercado Pago vuelve con el resultado en la URL: `status` (o `collection_status`).
  const resultadoMp = params.get('status') ?? params.get('collection_status');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const [estado, setEstado] = useState<EstadoPagoReserva | null>(null);
  const [metodos, setMetodos] = useState<MetodosPago | null>(null);
  const [verTransferencia, setVerTransferencia] = useState(false);

  useEffect(() => {
    if (!reservaId) return;
    let cancelado = false;
    void Promise.all([getEstadoPago(reservaId), getMetodosPago()]).then(([e, m]) => {
      if (cancelado) return;
      setEstado(e); setMetodos(m);
    });
    return () => { cancelado = true; };
  }, [reservaId]);

  function reintentar() {
    if (!reservaId) return;
    setError('');
    start(async () => {
      const r = await crearPreferenciaPago(reservaId);
      if (!r.ok) { setError(r.error); return; }
      window.location.href = r.data.checkoutUrl;
    });
  }

  const enRevision = resultadoMp === 'in_process' || resultadoMp === 'pending';
  const rechazado = resultadoMp === 'rejected';
  const esperando = estado?.estado === 'ESPERANDO_SENA';
  const puedeTransferir = !!(esperando && metodos?.transferencia && estado?.montoSena && estado.montoSena > 0);
  const wa = (metodos?.adminWhatsapp ?? '').replace(/\D/g, '');

  const base = 'flex flex-1 flex-col items-center justify-center gap-4 bg-neutral-950 p-6 text-center text-neutral-100';

  // El webhook ya la confirmó mientras el cliente volvía.
  if (estado && (estado.estado === 'CONFIRMADA' || estado.estado === 'COMPLETADA')) {
    return (
      <main className={base}>
        <div className="text-6xl">✅</div>
        <h1 className="text-2xl font-bold">¡Tu pago se acreditó!</h1>
        <p className="text-neutral-400">Tu turno está confirmado. Te avisamos por WhatsApp.</p>
        <Link href="/" className="rounded-xl border-2 border-lime-500 px-6 py-3 font-semibold text-lime-400">Volver al inicio</Link>
      </main>
    );
  }

  // Pasaron los minutos de reserva y el horario se liberó.
  if (estado && estado.estado === 'CANCELADA') {
    return (
      <main className={base}>
        <div className="text-6xl">⏱️</div>
        <h1 className="text-2xl font-bold">Ese horario se liberó</h1>
        <p className="text-neutral-400">
          Pasó el tiempo de reserva sin que se acreditara el pago.
          {wa ? ' Si ya pagaste, escribinos por WhatsApp y lo resolvemos.' : ' Si ya pagaste, contactanos y lo resolvemos.'}
        </p>
        {wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-lime-400 underline">Escribir por WhatsApp</a>}
        <Link href="/" className="rounded-xl bg-lime-500 px-6 py-3 font-bold text-black">Reservar otro horario</Link>
      </main>
    );
  }

  return (
    <main className={base}>
      <div className="text-6xl">{enRevision ? '⏳' : '⚠️'}</div>
      <h1 className="text-2xl font-bold">
        {enRevision ? 'Tu pago está en revisión' : rechazado ? 'Mercado Pago no pudo procesar el pago' : 'No se completó el pago'}
      </h1>

      {enRevision ? (
        <p className="text-neutral-400">
          Mercado Pago lo está verificando. Apenas se apruebe te confirmamos el turno por WhatsApp.
          Tu horario queda reservado por un tiempo limitado; si pasa mucho sin acreditarse, se libera.
        </p>
      ) : rechazado ? (
        <p className="text-neutral-400">
          A veces el sistema de seguridad de Mercado Pago rechaza un pago aunque haya fondos y los datos estén bien.
          {puedeTransferir ? ' Podés confirmar tu turno pagando la seña por transferencia.' : ''}
        </p>
      ) : (
        <p className="text-neutral-400">
          Tu horario queda reservado por un tiempo limitado. Si no completás el pago en ese lapso se libera,
          así que te conviene reintentarlo ahora{puedeTransferir ? ' o pagar por transferencia' : ' o contactarnos directamente'}.
        </p>
      )}

      {error && <p className="text-red-400">{error}</p>}

      {puedeTransferir && estado && metodos && (
        verTransferencia ? (
          <div className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-900 p-4 text-left">
            <DatosTransferencia metodos={metodos} montoSena={estado.montoSena!} resumenTurno={resumenDe(estado)} onCerrar={() => setVerTransferencia(false)} />
          </div>
        ) : (
          <button type="button" onClick={() => setVerTransferencia(true)}
            className={`rounded-xl px-6 py-3 font-bold ${rechazado ? 'bg-lime-500 text-black' : 'border-2 border-lime-500 text-lime-400'}`}>
            Pagar la seña por transferencia
          </button>
        )
      )}

      {reservaId && !enRevision && !verTransferencia && (
        <button type="button" disabled={pending} onClick={reintentar}
          className={`rounded-xl px-6 py-3 font-bold disabled:opacity-50 ${rechazado && puedeTransferir ? 'border-2 border-neutral-600 text-neutral-300' : 'bg-lime-500 text-black'}`}>
          {pending ? 'Generando link…' : rechazado ? 'Probar con otra tarjeta o cuenta' : 'Reintentar pago'}
        </button>
      )}

      {wa && !verTransferencia && (
        <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="text-sm text-neutral-400 underline">
          ¿Necesitás ayuda? Escribinos por WhatsApp
        </a>
      )}
    </main>
  );
}
