import { Router } from 'express';
import { z } from 'zod';
import { authJwt } from '../middlewares/authJwt.js';
import { validate } from '../middlewares/validate.js';
import { cobroService } from '../services/cobro.service.js';
import { auditService } from '../services/audit.service.js';

const idSchema = z.object({
  body: z.unknown(),
  query: z.looseObject({}),
  params: z.object({ id: z.string().min(1) }),
});

export const cobroRoutes = Router();

cobroRoutes.delete('/:id', authJwt, validate(idSchema), async (req, res, next) => {
  try {
    const out = await cobroService.eliminar(String(req.params.id));
    await auditService.log(req, {
      accion: 'ELIMINAR',
      entidad: 'Cobro',
      entidadId: String(req.params.id),
      descripcion: 'Anuló un cobro de $' + out.monto.toLocaleString('es-AR'),
    });
    res.json(out);
  } catch (e) {
    next(e);
  }
});
