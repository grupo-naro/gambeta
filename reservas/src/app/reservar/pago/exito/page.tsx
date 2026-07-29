import Link from 'next/link';

export default function PagoExitoPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-950 p-6 text-center text-neutral-100">
      <div className="text-6xl">✅</div>
      <h1 className="text-2xl font-bold">¡Gracias!</h1>
      <p className="text-neutral-400">Estamos confirmando tu pago. En unos minutos vas a recibir la confirmación por WhatsApp.</p>
      <Link href="/reservar" className="rounded-xl border-2 border-lime-500 px-6 py-3 font-semibold text-lime-400">Hacer otra reserva</Link>
    </main>
  );
}
