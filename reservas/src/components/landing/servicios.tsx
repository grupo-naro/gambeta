import Link from 'next/link';
import { BotonWhatsapp } from './boton-whatsapp';

/** Lo reservable online: manda la jerarquía. */
const PRINCIPALES = [
  {
    titulo: 'Pádel',
    texto: 'Canchas modernas, para todos los niveles. Elegí día y horario y jugá.',
    emoji: '🎾',
  },
  {
    titulo: 'Fútbol',
    texto: 'Espacios para todas las edades. Armá el partido y reservá en un minuto.',
    emoji: '⚽',
  },
] as const;

export function Servicios() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-20">
      <h2 className="text-center font-display text-3xl uppercase tracking-tight sm:text-5xl">
        Todo lo que vas a <span className="text-lime-400">encontrar</span>
      </h2>

      {/* Principales: grandes, cada una entra a la reserva. */}
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {PRINCIPALES.map((s) => (
          <Link
            key={s.titulo}
            href="/reservar"
            className="group rounded-3xl border border-neutral-800 bg-neutral-900 p-7 transition hover:border-lime-500"
          >
            <span className="text-4xl" aria-hidden>
              {s.emoji}
            </span>
            <h3 className="mt-4 font-display text-2xl uppercase tracking-tight text-lime-400">
              {s.titulo}
            </h3>
            <p className="mt-2 text-sm text-neutral-400">{s.texto}</p>
            <span className="mt-5 inline-block text-sm font-semibold text-neutral-100 group-hover:text-lime-400">
              Reservar →
            </span>
          </Link>
        ))}
      </div>

      {/* Secundarios: más chicos, no son reservables online. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
          <span className="text-2xl" aria-hidden>
            🏆
          </span>
          <h3 className="mt-3 text-lg font-bold text-neutral-100">Torneos</h3>
          <p className="mt-1 text-sm text-neutral-400">
            Competencia, diversión y comunidad. Consultá fechas y cupos.
          </p>
          <BotonWhatsapp
            mensaje="¡Hola! Quiero información sobre los torneos."
            tamano="chico"
            className="mt-auto pt-4"
          >
            Consultar torneos
          </BotonWhatsapp>
        </div>

        <div className="flex flex-col rounded-3xl border border-neutral-800 bg-neutral-900/60 p-6">
          <span className="text-2xl" aria-hidden>
            🍔
          </span>
          <h3 className="mt-3 text-lg font-bold text-neutral-100">Bar Urban Food</h3>
          <p className="mt-1 text-sm text-neutral-400">
            Buena comida y el mejor ambiente, antes o después de jugar.
          </p>
        </div>
      </div>
    </section>
  );
}
