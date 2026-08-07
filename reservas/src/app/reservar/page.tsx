import { PantallaReserva } from "@/components/pantalla-reserva";
import { ReservasCerradas } from "@/components/reservas-cerradas";
import { getCobrosOnline } from "@/lib/actions";

export default async function ReservarPage() {
  // Se decide acá, del lado del servidor, y no dentro de PantallaReserva: si no hay con qué
  // cobrar la seña, ni siquiera se manda al navegador la pantalla de reserva.
  const cobrosOnline = await getCobrosOnline();
  return (
    <main className="flex min-h-screen flex-1 flex-col bg-neutral-950 text-neutral-100">
      {cobrosOnline ? <PantallaReserva /> : <ReservasCerradas />}
    </main>
  );
}
