import { PantallaReserva } from "@/components/pantalla-reserva";
import { ReservasCerradas } from "@/components/reservas-cerradas";
import { getMetodosPago } from "@/lib/actions";

// La home consulta `/config/sena` en el backend para decidir si hay con qué cobrar la seña.
// Durante `next build` (imagen Docker de deploy-prod) no hay red hacia `backend`, así que ese
// fetch falla y `getMetodosPago()` devuelve todo en falso. Si la página se prerenderizara
// estática, quedaría horneada como `ReservasCerradas` para siempre. Forzamos render dinámico:
// se resuelve en cada request, con el backend ya disponible.
export const dynamic = "force-dynamic";

export default async function Home() {
  // Se decide acá, del lado del servidor, y no dentro de PantallaReserva: si no hay con qué
  // cobrar la seña, ni siquiera se manda al navegador la pantalla de reserva.
  //
  // Antes la condición era "¿hay cuenta de Mercado Pago?". Ya no: con el CBU cargado se puede
  // cobrar igual, así que el sitio solo cierra cuando no hay NINGÚN método.
  const metodos = await getMetodosPago();
  const hayAlgunMetodo = metodos.mercadoPago || metodos.transferencia;
  return (
    <main className="flex flex-1 flex-col bg-neutral-950 text-neutral-100">
      {hayAlgunMetodo ? <PantallaReserva metodos={metodos} /> : <ReservasCerradas />}
    </main>
  );
}
