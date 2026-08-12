'use client';
import { useState } from 'react';
import type { MetodosPago } from '@/lib/types';

const money = (n: number | null) => (n == null ? '' : '$' + Number(n).toLocaleString('es-AR'));

function Copiable({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  const [estado, setEstado] = useState<'idle' | 'copiado' | 'error'>('idle');
  if (!valor.trim()) return null;

  // navigator.clipboard puede faltar (contexto no seguro) o writeText puede rechazar
  // (permiso denegado): en ningún caso queremos una excepción sin agarrar ni una promise
  // rota — el usuario siempre se entera de si copió o no. El dato sigue visible arriba
  // para copiarlo a mano si el botón falla.
  const copiar = () => {
    const avisar = (siguiente: 'copiado' | 'error') => {
      setEstado(siguiente);
      setTimeout(() => setEstado('idle'), 1500);
    };
    try {
      if (!navigator.clipboard) {
        avisar('error');
        return;
      }
      navigator.clipboard.writeText(valor).then(
        () => avisar('copiado'),
        () => avisar('error'),
      );
    } catch {
      avisar('error');
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-neutral-800 p-3">
      <div className="min-w-0">
        <p className="text-xs uppercase text-neutral-500">{etiqueta}</p>
        <p className="truncate font-semibold text-neutral-100">{valor}</p>
      </div>
      <button
        type="button"
        onClick={copiar}
        className="shrink-0 rounded-lg border border-neutral-600 px-3 py-1 text-xs font-semibold text-neutral-200"
      >
        {estado === 'copiado' ? 'Copiado' : estado === 'error' ? 'No se pudo copiar' : 'Copiar'}
      </button>
    </div>
  );
}

/**
 * Qué hacer para pagar la seña por transferencia.
 *
 * El monto sale de la reserva ya creada, no de la configuración: cada cancha puede tener su
 * propia seña, así que recién se conoce cuando el backend responde.
 */
export function DatosTransferencia({
  metodos, montoSena, resumenTurno, onCerrar,
}: {
  metodos: MetodosPago;
  montoSena: number;
  resumenTurno: string;
  onCerrar: () => void;
}) {
  const wa = metodos.adminWhatsapp.replace(/\D/g, '');
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xl font-bold">Transferí para confirmar</h3>
      <p className="text-sm text-neutral-400">{resumenTurno}</p>

      <p className="text-neutral-200">
        Seña a transferir: <b className="text-lime-400">{money(montoSena)}</b>
      </p>

      <div className="flex flex-col gap-2">
        <Copiable etiqueta="Alias" valor={metodos.alias} />
        <Copiable etiqueta="CBU" valor={metodos.cbu} />
        {metodos.titular.trim() && (
          <p className="text-sm text-neutral-400">Titular: {metodos.titular}</p>
        )}
      </div>

      {/* Sin número cargado no se muestra el pedido: un wa.me roto es peor que no pedirlo. */}
      {wa ? (
        <p className="text-neutral-200">
          Mandá el comprobante por{' '}
          <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-lime-400 underline">
            WhatsApp
          </a>{' '}
          para que confirmemos el turno.
        </p>
      ) : (
        <p className="text-neutral-200">Mandanos el comprobante para que confirmemos el turno.</p>
      )}

      <p className="text-sm text-amber-400">
        Tenés {metodos.senaTimeoutMinutos} minutos para transferir y mandar el comprobante. Pasado
        ese tiempo, el horario se libera.
      </p>

      <button type="button" onClick={onCerrar} className="mt-2 rounded-xl bg-lime-500 px-6 py-2 font-bold text-black">
        Listo
      </button>
    </div>
  );
}
