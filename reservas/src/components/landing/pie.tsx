import Image from 'next/image';
import { negocio } from '@/lib/negocio';
import { BotonReservar } from './boton-reservar';

const REDES = [
  { nombre: 'Instagram', url: negocio.redes.instagram },
  { nombre: 'TikTok', url: negocio.redes.tiktok },
] as const;

export function Pie() {
  return (
    /* pb-28 en mobile deja aire para que la barra fija no tape el contenido. */
    <footer className="border-t border-neutral-800 px-6 pb-28 pt-12 text-center md:pb-12">
      {/* Misma razón que en el hero: el wordmark es gris oscuro y necesita fondo claro. */}
      <div className="mx-auto mb-8 w-fit rounded-2xl bg-white p-3">
        <Image
          src="/logo.png"
          alt={negocio.nombre}
          width={1695}
          height={1877}
          sizes="110px"
          className="h-auto w-[110px]"
        />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {REDES.map((r) =>
          r.url ? (
            <a
              key={r.nombre}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-neutral-700 px-5 py-2 text-sm font-semibold text-neutral-100 transition hover:border-lime-500 hover:text-lime-400"
            >
              {r.nombre}
            </a>
          ) : (
            <span
              key={r.nombre}
              className="rounded-full border border-neutral-800 px-5 py-2 text-sm text-neutral-600"
              title={`Falta cargar la URL de ${r.nombre} en negocio.ts`}
            >
              {r.nombre}
            </span>
          ),
        )}
      </div>

      <p className="mt-8 text-xs uppercase tracking-[0.2em] text-neutral-500">
        {negocio.nombre} · {negocio.rubro}
      </p>
    </footer>
  );
}

/** Barra fija de reserva. Solo mobile: en desktop el CTA del hero queda visible. */
export function BarraReservaMobile() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-800 bg-neutral-950/95 p-3 backdrop-blur md:hidden">
      <BotonReservar tamano="ancho" />
    </div>
  );
}
