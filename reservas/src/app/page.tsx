import { Hero } from '@/components/landing/hero';
import { Servicios } from '@/components/landing/servicios';
import { ComoReservar } from '@/components/landing/como-reservar';
import { Ubicacion } from '@/components/landing/ubicacion';
import { Pie, BarraReservaMobile } from '@/components/landing/pie';

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-neutral-950 text-neutral-100">
      <Hero />
      <Servicios />
      <ComoReservar />
      <Ubicacion />
      <Pie />
      <BarraReservaMobile />
    </main>
  );
}
