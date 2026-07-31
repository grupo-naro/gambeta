import { BotonReservar } from './boton-reservar';

const PASOS = [
  {
    n: '1',
    titulo: 'Elegí deporte y día',
    texto: 'Pádel o fútbol, y la fecha que estás buscando.',
  },
  {
    n: '2',
    titulo: 'Elegí el horario',
    texto: 'Vas a ver solo los turnos que están realmente libres.',
  },
  {
    n: '3',
    titulo: 'Confirmá con la seña',
    texto: 'Pagás la seña online y el turno te queda reservado.',
  },
] as const;

export function ComoReservar() {
  return (
    <section className="border-y border-neutral-800 bg-neutral-900/40">
      <div className="mx-auto w-full max-w-5xl px-6 py-20">
        <h2 className="text-center font-display text-3xl uppercase tracking-tight sm:text-5xl">
          Reservar es <span className="text-lime-400">así de simple</span>
        </h2>

        <ol role="list" className="mt-10 grid gap-6 sm:grid-cols-3">
          {PASOS.map((p) => (
            <li key={p.n} className="text-center sm:text-left">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-lime-500 font-display text-xl text-black">
                {p.n}
              </span>
              <h3 className="mt-4 text-lg font-bold text-neutral-100">{p.titulo}</h3>
              <p className="mt-1 text-sm text-neutral-400">{p.texto}</p>
            </li>
          ))}
        </ol>

        <div className="mt-10 text-center">
          <BotonReservar />
        </div>
      </div>
    </section>
  );
}
