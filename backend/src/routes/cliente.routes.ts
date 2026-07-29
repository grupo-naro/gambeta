import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authJwt } from '../middlewares/authJwt.js';
import { authAny } from '../middlewares/authAny.js';
import { clienteService } from '../services/cliente.service.js';
import { upsertClienteSchema, buscarClienteSchema, editarClienteSchema } from '../validators/cliente.schema.js';

export const clienteRoutes = Router();

clienteRoutes.get('/', authJwt, async (_req, res, next) => {
  try { res.json(await clienteService.list()); } catch (e) { next(e); }
});
clienteRoutes.get('/buscar', authAny, validate(buscarClienteSchema), async (req, res, next) => {
  try { res.json(await clienteService.buscarPorWhatsapp(String((req as any).valid.query.whatsapp))); } catch (e) { next(e); }
});
clienteRoutes.get('/:id', authJwt, async (req, res, next) => {
  try { res.json(await clienteService.get(String(req.params.id))); } catch (e) { next(e); }
});
clienteRoutes.post('/', authAny, validate(upsertClienteSchema), async (req, res, next) => {
  try { res.json(await clienteService.upsert((req as any).valid.body)); } catch (e) { next(e); }
});
clienteRoutes.patch('/:id', authJwt, validate(editarClienteSchema), async (req, res, next) => {
  try { res.json(await clienteService.editar(String(req.params.id), (req as any).valid.body)); } catch (e) { next(e); }
});
clienteRoutes.delete('/:id', authJwt, async (req, res, next) => {
  try { res.json(await clienteService.eliminar(String(req.params.id))); } catch (e) { next(e); }
});
