import { apiFetch } from '@/lib/api';
import { hoyAR } from '@/lib/fecha';
import type { GrillaDisponibilidad } from '@/lib/types';
import { DisponibilidadDia } from '@/components/disponibilidad/disponibilidad-dia';

type Params = { deporte?: string; fecha?: string; franja?: string };

export default async function DisponibilidadPage({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const hoy = hoyAR();
  const deporte = q.deporte === 'futbol' ? 'futbol' : 'padel';
  const fecha = q.fecha && /^\d{4}-\d{2}-\d{2}$/.test(q.fecha) ? q.fecha : hoy;
  const franja = ['manana', 'tarde', 'noche', 'todo'].includes(q.franja ?? '') ? (q.franja as string) : 'todo';
  const grilla = await apiFetch<GrillaDisponibilidad>(`/disponibilidad/grilla?deporte=${deporte}&fecha=${fecha}`);
  return <DisponibilidadDia grilla={grilla} deporte={deporte} fecha={fecha} franja={franja} hoy={hoy} />;
}
