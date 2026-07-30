import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 bg-emerald-50 p-6 text-center">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">Gambeteando</p>
        <h1 className="mt-2 text-4xl font-bold text-emerald-900 sm:text-5xl">Reservá tu cancha</h1>
        <p className="mt-3 text-lg text-emerald-800/80">Fútbol o pádel, en segundos.</p>
      </div>
      <Link href="/reservar" className="rounded-2xl bg-emerald-600 px-8 py-4 text-2xl font-bold text-white shadow-lg shadow-emerald-600/30 active:scale-95">
        Reservá tu cancha
      </Link>
    </main>
  );
}
