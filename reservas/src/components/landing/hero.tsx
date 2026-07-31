import Image from 'next/image';
import { negocio } from '@/lib/negocio';
import { BotonReservar } from './boton-reservar';
import { BotonWhatsapp } from './boton-whatsapp';

export function Hero() {
  return (
    <section className="relative flex min-h-[100svh] flex-col items-center justify-center gap-6 overflow-hidden px-6 py-10 text-center sm:gap-8 sm:py-16">
      {/* Halo lima detrás del contenido. Puro CSS, sin imagen. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[70vh] bg-[radial-gradient(65%_55%_at_50%_0%,rgba(163,230,53,0.18),transparent)]"
      />

      {/* Tarjeta blanca: el wordmark del logo es gris oscuro y sobre negro no se lee. */}
      <div className="relative rounded-3xl bg-white p-5 shadow-2xl shadow-lime-500/10 sm:p-7">
        <Image
          src="/logo.png"
          alt={`${negocio.nombre} — ${negocio.rubro}`}
          width={1695}
          height={1877}
          priority
          sizes="(min-width: 640px) 260px, 190px"
          className="h-auto w-[150px] sm:w-[260px]"
        />
      </div>

      <h1 className="relative max-w-4xl font-display text-4xl uppercase leading-[0.92] tracking-tight sm:text-6xl lg:text-7xl">
        Más que un <span className="text-lime-400">predio</span>,
        <br />
        una experiencia <span className="text-lime-400">deportiva</span>
      </h1>

      <p className="relative max-w-xl text-base text-neutral-400 sm:text-lg">
        Canchas de pádel y fútbol en {negocio.direccion.localidad}. Torneos, encuentros
        deportivos y Bar Urban Food.
      </p>

      <div className="relative flex w-full max-w-md flex-col gap-3 sm:w-auto sm:flex-row">
        <BotonReservar />
        <BotonWhatsapp />
      </div>

      <p className="relative text-sm text-neutral-400">
        Reservá online en menos de un minuto.
      </p>
    </section>
  );
}
