import { negocio, whatsappUrl, direccionCompleta } from '@/lib/negocio';

/**
 * Reemplaza a la pantalla de reserva mientras la reserva online no esté habilitada al público.
 * Ojo con `whatsappUrl()`, que devuelve `null` mientras el número siga pendiente de carga —
 * en ese caso se muestra el texto sin botón, nunca un enlace roto.
 */
export function Proximamente() {
  const wa = whatsappUrl('¡Hola! Quiero reservar una cancha.');
  const direccion = direccionCompleta();

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border-2 border-neutral-700 bg-neutral-900 p-6 text-center">
        <p className="text-4xl" aria-hidden="true">⚽</p>
        <h1 className="mt-3 font-[family-name:var(--font-anton)] text-3xl uppercase tracking-wide text-neutral-100">
          Próximamente
        </h1>
        <p className="mt-2 text-sm text-neutral-400">
          Muy pronto vas a poder reservar tu cancha online. Mientras tanto, escribinos y coordinamos tu turno.
        </p>

        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            className="mt-5 block rounded-xl bg-lime-500 px-5 py-3 font-bold text-neutral-950"
          >
            Reservar por WhatsApp
          </a>
        ) : (
          <p className="mt-5 rounded-xl border border-neutral-700 px-5 py-3 text-sm font-medium text-neutral-300">
            Contactanos por WhatsApp o acercate al complejo para reservar.
          </p>
        )}

        <p className="mt-4 text-xs text-neutral-500">
          {negocio.horarios.resumen}
          {direccion && <> · {direccion}</>}
        </p>
      </div>
    </div>
  );
}
