import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('365d'),
  SERVICE_API_KEY: z.string().min(1),
  SERVICE_API_KEYS: z.string().default(''),
  BUFFET_API_KEY: z.string().default(''),
  EVOLUTION_URL: z.string().default('http://evolution:8080'),
  EVOLUTION_API_KEY: z.string().default(''),
  EVOLUTION_INSTANCE: z.string().default(''),
  MP_ACCESS_TOKEN: z.string().default(''),
  MP_WEBHOOK_SECRET: z.string().default(''),
  RESERVAS_PUBLIC_URL: z.string().default(''),
  BACKEND_PUBLIC_URL: z.string().default(''),
  TZ_NEGOCIO: z.string().default('America/Argentina/Buenos_Aires'),
  CANCELACION_ANTICIPACION_MINUTOS: z.coerce.number().int().nonnegative().default(10),
  REPROGRAMACION_ANTICIPACION_HORAS: z.coerce.number().int().nonnegative().default(2),
  SENA_TIMEOUT_MINUTOS: z.coerce.number().int().positive().default(30),
  SENA_MODO: z.enum(['porcentaje', 'fijo']).default('porcentaje'),
  SENA_PORCENTAJE: z.coerce.number().int().min(0).max(100).default(50),
  SENA_MONTO_FIJO: z.coerce.number().nonnegative().default(5000),
  SENA_CBU: z.string().default(''),
  SENA_ALIAS: z.string().default(''),
  SENA_TITULAR: z.string().default(''),
  ADMIN_SEED_EMAIL: z.email(),
  ADMIN_SEED_PASSWORD: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  GOOGLE_SERVICE_ACCOUNT: z.string().default(''),
  SHEETS_SPREADSHEET_ID: z.string().default(''),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  return schema.parse(raw);
}

let cached: Env | null = null;
export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
