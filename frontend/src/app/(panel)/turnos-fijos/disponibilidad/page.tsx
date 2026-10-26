import { apiFetch } from '@/lib/api';
import { hoyAR } from '@/lib/fecha';
import type { Cancha, DisponibilidadSemanal } from '@/lib/types';
import { DisponibilidadSemanalVista } from '@/components/fijos/disponibilidad-semanal';

type Params = { deporte?: string; dia?: string; dur?: string };

export default async function DisponibilidadPage({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const deporte = q.deporte === 'futbol' ? 'futbol' : 'padel';
  const hoyDia = new Date(hoyAR() + 'T12:00:00Z').getUTCDay();
  const dia = q.dia != null && /^[0-6]$/.test(q.dia) ? Number(q.dia) : hoyDia;
  const dur = [60, 90, 120].includes(Number(q.dur)) ? Number(q.dur) : 60;
  const [datos, canchas] = await Promise.all([
    apiFetch<DisponibilidadSemanal>(`/turnos-fijos/disponibilidad?deporte=${deporte}&diaSemana=${dia}&duracionMin=${dur}`),
    apiFetch<Cancha[]>('/canchas'),
  ]);
  return <DisponibilidadSemanalVista datos={datos} canchas={canchas} deporte={deporte} dia={dia} dur={dur} />;
}
