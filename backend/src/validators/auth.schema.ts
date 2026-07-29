import { z } from 'zod';

export const loginSchema = z.object({
  body: z.object({ email: z.email(), password: z.string().min(1) }),
  query: z.looseObject({}),
  params: z.looseObject({}),
});
