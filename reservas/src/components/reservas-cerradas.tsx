import { negocio, whatsappUrl, direccionCompleta } from '@/lib/negocio';

/**
 * Se muestra en lugar de la grilla cuando el complejo no tiene ningún método para cobrar la
 * seña disponible (ni Mercado Pago vinculado ni datos de transferencia cargados): sin uno de
 * los dos no hay forma de cobrarla, así que no se toman reservas por la web.
 *
 * El objetivo es que el cliente no se vaya: se le da la vía alternativa para reservar igual.
 * Ojo con `whatsappUrl()`, que devuelve `null` mientras el número siga pendiente de carga —
 * en ese caso se muestra el texto sin botón, nunca un enlace roto.
 */
export function ReservasCerradas() {
  const wa = whatsappUrl('¡Hola! Quiero reservar una cancha.');
  const direccion = direccionCompleta();

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border-2 border-neutral-700 bg-neutral-900 p-6 text-center">
        <p className="text-4xl" aria-hidden="true">📆</p>
        <h1 className="mt-3 text-xl font-bold text-neutral-100">Por ahora no tomamos reservas por la web</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Estamos con el sistema de pagos en mantenimiento. Las canchas siguen funcionando normal: escribinos y coordinamos tu turno.
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
