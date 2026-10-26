import { apiFetch } from '@/lib/api';
import { hoyAR } from '@/lib/fecha';
import type { GrillaDisponibilidad } from '@/lib/types';
import { DisponibilidadDia } from '@/components/disponibilidad/disponibilidad-dia';

type Params = { deporte?: string; fecha?: string; franja?: string };

export default async function DisponibilidadPage({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const hoy = hoyAR();
  const deporte = q.deporte === 'futbol' || q.deporte === 'padel' ? q.deporte : '';
  const fecha = q.fecha && /^\d{4}-\d{2}-\d{2}$/.test(q.fecha) ? q.fecha : '';
  const franja = ['manana', 'tarde', 'noche', 'todo'].includes(q.franja ?? '') ? (q.franja as string) : 'todo';
  // Sin día y deporte elegidos solo se muestra el formulario; la grilla se pide recién al buscar.
  const grilla = deporte && fecha
    ? await apiFetch<GrillaDisponibilidad>(`/disponibilidad/grilla?deporte=${deporte}&fecha=${fecha}`)
    : null;
  return <DisponibilidadDia grilla={grilla} deporte={deporte} fecha={fecha} franja={franja} hoy={hoy} />;
}
