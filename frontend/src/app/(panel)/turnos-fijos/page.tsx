import { apiFetch } from '@/lib/api';
import type { Cancha, TurnoFijo } from '@/lib/types';
import { TurnosFijosTable } from '@/components/fijos/turnos-fijos-table';

export default async function TurnosFijosPage() {
  const [fijos, canchas] = await Promise.all([
    apiFetch<TurnoFijo[]>('/turnos-fijos'),
    apiFetch<Cancha[]>('/canchas'),
  ]);
  return <TurnosFijosTable fijos={fijos} canchas={canchas} />;
}
