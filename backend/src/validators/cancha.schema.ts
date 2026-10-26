import { z } from 'zod';
const empty = z.looseObject({});

const jugadoresFutbol = z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(9), z.literal(11)]);
const jugadores = z.union([z.literal(0), z.literal(5), z.literal(6), z.literal(7), z.literal(9), z.literal(11)]);

export const crearDivisibleSchema = z.object({
  body: z.object({
    nombre: z.string().min(1),
    partes: z.number().int().min(2).max(6),
    precioEntera: z.number().positive(),
    precioParte: z.number().positive(),
    jugadoresEntera: jugadoresFutbol,
    jugadoresParte: jugadoresFutbol,
  }),
  query: empty, params: empty,
});

export const createCanchaSchema = z.object({
  body: z.object({ nombre: z.string().min(1), tipo: z.string().min(1), precioHora: z.number().positive(), jugadores, destacada: z.boolean().optional().default(false), precioHoraPico: z.number().nonnegative().optional().default(0), senaMonto: z.number().nonnegative().nullable().optional(), precio90: z.number().positive().nullable().optional(), precio90Pico: z.number().positive().nullable().optional(), precio120: z.number().positive().nullable().optional(), precio120Pico: z.number().positive().nullable().optional(),
    turnoBloqueMin: z.union([z.literal(60), z.literal(90), z.literal(120)]).nullable().optional(),
    turnoDesfaseMin: z.number().int().min(0).max(120).refine((n) => n % 30 === 0, 'El desfase va de a 30 minutos').optional() }),
  query: empty, params: empty,
});
export const updateCanchaSchema = z.object({
  body: z.object({ nombre: z.string().min(1).optional(), tipo: z.string().min(1).optional(), precioHora: z.number().positive().optional(), jugadores: jugadores.optional(), destacada: z.boolean().optional(), precioHoraPico: z.number().nonnegative().optional(), senaMonto: z.number().nonnegative().nullable().optional(), precio90: z.number().positive().nullable().optional(), precio90Pico: z.number().positive().nullable().optional(), precio120: z.number().positive().nullable().optional(), precio120Pico: z.number().positive().nullable().optional(),
    turnoBloqueMin: z.union([z.literal(60), z.literal(90), z.literal(120)]).nullable().optional(),
    turnoDesfaseMin: z.number().int().min(0).max(120).refine((n) => n % 30 === 0, 'El desfase va de a 30 minutos').optional() }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});
export const escalonarPadelSchema = z.object({
  body: z.object({
    // null = agenda libre (inicios cada media hora). `quitar` deja las canchas sin escalonar.
    bloqueMin: z.union([z.literal(60), z.literal(90), z.literal(120)]).nullable().default(null),
    quitar: z.boolean().default(false),
    pasoMin: z.union([z.literal(30), z.literal(60)]).default(30),
  }),
  query: empty, params: empty,
});
export const setActivaSchema = z.object({
  body: z.object({ activa: z.boolean() }),
  query: empty, params: z.object({ id: z.string().min(1) }),
});
export const listCanchaSchema = z.object({
  body: z.unknown(), params: empty,
  query: z.looseObject({ activa: z.enum(['true', 'false']).optional() }),
});
export const idCanchaParamSchema = z.object({
  body: z.unknown(),
  query: empty,
  params: z.object({ id: z.string().min(1) }),
});
