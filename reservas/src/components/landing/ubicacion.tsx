import { negocio, direccionCompleta } from '@/lib/negocio';
import { BotonWhatsapp } from './boton-whatsapp';

export function Ubicacion() {
  const { mapsUrl } = negocio.direccion;

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-20">
      <h2 className="text-center font-display text-3xl uppercase tracking-tight sm:text-5xl">
        Dónde y <span className="text-lime-400">cuándo</span>
      </h2>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-6">
          <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-lime-400">
            Ubicación
          </h3>
          <p className="mt-2 text-sm text-neutral-300">{direccionCompleta()}</p>
          {mapsUrl ? (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-sm font-semibold text-neutral-100 hover:text-lime-400"
            >
              Cómo llegar →
            </a>
          ) : (
            <span
              className="mt-4 inline-block text-sm text-neutral-600"
              title="Falta cargar mapsUrl en negocio.ts"
            >
              Cómo llegar →
            </span>
          )}
        </div>

        <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-6">
          <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-lime-400">
            Horarios
          </h3>
          <p className="mt-2 text-sm text-neutral-300">{negocio.horarios.resumen}</p>
        </div>

        <div className="rounded-3xl border border-neutral-800 bg-neutral-900 p-6">
          <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-lime-400">
            Contacto
          </h3>
          <p className="mt-2 text-sm text-neutral-300">
            Consultas y reservas por WhatsApp.
          </p>
          <BotonWhatsapp tamano="chico" className="mt-4">
            Escribinos
          </BotonWhatsapp>
        </div>
      </div>
    </section>
  );
}
