import rateLimit from 'express-rate-limit';

// Anti fuerza-bruta del login: pocos intentos por IP en una ventana amplia.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos, probá más tarde' },
});

// Anti-flood general, holgado para no estrangular al bot ni al panel.
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, esperá un momento' },
});
