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
  app.use(pinoHttp({ logger }));
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(generalLimiter);
  app.use(apiRouter);
  app.use(errorHandler);
  return app;
}
