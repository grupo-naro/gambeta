import { prisma } from '../db/prisma.js';

// Horario operativo por defecto para una cancha nueva (igual que el seed): 16:00–23:00 todos los días.
const HORA_INICIO_DEFAULT = '16:00';
const HORA_FIN_DEFAULT = '23:00';

export const horarioRepo = {
  forCanchaAndDay: (canchaId: string, diaSemana: number) =>
    prisma.horarioDisponible.findMany({ where: { canchaId, diaSemana, activo: true }, orderBy: { horaInicio: 'asc' } }),
  createDefaults: (canchaId: string) =>
    prisma.horarioDisponible.createMany({
      data: Array.from({ length: 7 }, (_, diaSemana) => ({
        canchaId,
        diaSemana,
        horaInicio: HORA_INICIO_DEFAULT,
        horaFin: HORA_FIN_DEFAULT,
      })),
    }),
};
