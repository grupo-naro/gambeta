import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { logger } from './utils/logger.js';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { generalLimiter } from './middlewares/rateLimiters.js';

export function buildApp() {
  const app = express();
  app.set('trust proxy', 1); // hay Traefik delante; confiar solo en el primer proxy
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({
    logger,
    // El serializador por defecto vuelca req.headers completo. Sin este redact, la
    // x-buffet-key y el x-mostrador (que juntos alcanzan para operar como cualquier
    // mostrador, y el segundo no vence) quedan en texto plano en cada línea de log —
    // y en la VPS, cualquiera con acceso a `docker logs` se los lleva para siempre.
    redact: {
      paths: ['req.headers.authorization', 'req.headers["x-buffet-key"]', 'req.headers["x-mostrador"]'],
      censor: '[REDACTED]',
    },
  }));
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(generalLimiter);
  app.use(apiRouter);
  app.use(errorHandler);
  return app;
}
