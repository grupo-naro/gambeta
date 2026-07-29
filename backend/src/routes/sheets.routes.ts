import { Router } from 'express';
import { authJwt } from '../middlewares/authJwt.js';
import { requireRole } from '../middlewares/requireRole.js';
import { estaConfigurado, sheetUrl } from '../services/sheets/sheetsClient.js';
import { sheetsSync } from '../services/sheets/sheetsSync.service.js';
import { ServiceUnavailable } from '../utils/errors.js';

export const sheetsRoutes = Router();
sheetsRoutes.use(authJwt, requireRole('ADMIN'));

sheetsRoutes.get('/info', (_req, res) => {
  res.json({ configurado: estaConfigurado(), url: sheetUrl() });
});
sheetsRoutes.post('/sync', async (_req, res, next) => {
  try {
    if (!estaConfigurado()) throw ServiceUnavailable('Google Sheets no está configurado');
    await sheetsSync.sincronizarTodo();
    res.json({ ok: true });
  } catch (e) { next(e); }
});
