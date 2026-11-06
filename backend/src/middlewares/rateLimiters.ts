import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Anti fuerza-bruta del login: pocos intentos FALLIDOS por IP + usuario en una ventana amplia.
// Cuentan solo los fallidos (skipSuccessfulRequests) y la clave incluye el email: el panel llama
// al backend desde su propio servidor, así que todos los usuarios comparten IP y, con una clave
// solo por IP, tres personas que se equivocan un par de veces se bloqueaban entre sí.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return `${ipKeyGenerator(req.ip ?? '')}|${email}`;
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'DEMASIADOS_INTENTOS', message: 'Demasiados intentos, probá más tarde' } },
});

// Anti-flood general, holgado para no estrangular al bot ni al panel.
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, esperá un momento' },
});

// Intentos de PIN del dashboard: un PIN de 4 a 8 dígitos se adivina rápido sin tope. Por admin e IP.
export const pinDashboardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${(req as any).principal?.adminId ?? ''}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'DEMASIADOS_INTENTOS', message: 'Demasiados intentos de PIN, probá más tarde' } },
});
