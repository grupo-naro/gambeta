import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { authJwt } from '../middlewares/authJwt.js';
import { authAny } from '../middlewares/authAny.js';
import { reservaService } from '../services/reserva.service.js';
import { auditService } from '../services/audit.service.js';
import { cobroService } from '../services/cobro.service.js';
import { senaService } from '../services/sena.service.js';
import { canchaService } from '../services/cancha.service.js';
import { BusinessRule, Conflict } from '../utils/errors.js';
import {
  createReservaSchema,
  listReservaSchema,
  aprobarSenaSchema,
  reprogramarSchema,
  misReservasSchema,
  idParamSchema,
  buscarReservaSchema,
} from '../validators/reserva.schema.js';
import { crearCobroSchema } from '../validators/cobro.schema.js';

export const reservaRoutes = Router();

const adminId = (req: any) =>
  req.principal?.kind === 'admin' ? req.principal.adminId : undefined;

reservaRoutes.post('/', authAny, validate(createReservaSchema), async (req, res, next) => {
  try {
    const body = (req as any).valid.body;
    const porStaff = req.principal?.kind === 'admin';

    // Pre-validación de la seña del panel (antes de crear, para no dejar reservas huérfanas)
    let defaultSena: number | undefined;
    if (porStaff && body.cobroInicial === 'sena') {
      const cancha = await canchaService.get(body.canchaId);
      defaultSena = await senaService.montoParaCancha(cancha, Number(cancha.precioHora));
      const monto = body.montoCobro ?? defaultSena;
      if (monto < defaultSena) throw BusinessRule('La seña no puede ser menor a la seña de la cancha');
    }

    const r = await reservaService.crear(body, { porStaff });

    // Un turno de socio nace saldado (monto 0): cobrarle sería registrar plata contra deuda cero.
    // No se asienta ningún Cobro, pero tampoco queda silencioso — el staff puede haber recibido
    // la plata en mano en el mostrador, así que se avisa explícitamente con `cobroOmitido`.
    let cobroOmitido: boolean | undefined;
    if (porStaff && body.cobroInicial !== 'ninguno') {
      if (r.suscripcionId != null) {
        cobroOmitido = true;
      } else {
        const precio = Number(r.monto);
        const monto = body.cobroInicial === 'total' ? precio : (body.montoCobro ?? defaultSena!);
        const adminId = req.principal?.kind === 'admin' ? req.principal.adminId : null;
        if (monto > 0) await cobroService.crear(r.id, { monto, medio: body.medioCobro }, adminId);
      }
    }
    await auditService.log(req, { accion: 'CREAR', entidad: 'Reserva', entidadId: r.id, descripcion: 'Creó una reserva' });
    res.status(201).json(cobroOmitido !== undefined ? { ...r, cobroOmitido } : r);
  } catch (e) {
    next(e);
  }
});

reservaRoutes.get('/', authJwt, validate(listReservaSchema), async (req, res, next) => {
  try {
    res.json(await reservaService.list((req as any).valid.query));
  } catch (e) {
    next(e);
  }
});

// NOTE: /vencidas-sena MUST be registered before /:id to avoid shadowing
reservaRoutes.get('/vencidas-sena', authAny, async (_req, res, next) => {
  try {
    res.json(await reservaService.vencidasSena());
  } catch (e) {
    next(e);
  }
});

reservaRoutes.get('/mias', authAny, validate(misReservasSchema), async (req, res, next) => {
  try {
    res.json(await reservaService.misReservas((req as any).valid.query.whatsapp));
  } catch (e) {
    next(e);
  }
});

// NOTE: /buscar MUST be registered before /:id to avoid shadowing
reservaRoutes.get('/buscar', authAny, validate(buscarReservaSchema), async (req, res, next) => {
  try {
    res.json(await reservaService.buscar((req as any).valid.query));
  } catch (e) { next(e); }
});

reservaRoutes.get('/:id', authJwt, validate(idParamSchema), async (req, res, next) => {
  try {
    res.json(await reservaService.get(String(req.params.id)));
  } catch (e) {
    next(e);
  }
});

reservaRoutes.patch('/:id/aprobar-sena', authAny, validate(aprobarSenaSchema), async (req, res, next) => {
  try {
    res.json(
      await reservaService.aprobarSena(
        String(req.params.id),
        { adminId: adminId(req) },
        (req as any).valid.body,
      ),
    );
  } catch (e) {
    next(e);
  }
});

reservaRoutes.patch('/:id/rechazar-sena', authAny, validate(idParamSchema), async (req, res, next) => {
  try {
    const r = await reservaService.rechazarSena(String(req.params.id), { adminId: adminId(req) });
    // null = ya no estaba esperando seña (la aprobaron o ya se canceló).
    if (!r) throw Conflict('La reserva ya no está esperando la seña');
    res.json(r);
  } catch (e) {
    next(e);
  }
});

reservaRoutes.patch('/:id/cancelar', authAny, validate(idParamSchema), async (req, res, next) => {
  try {
    res.json(await reservaService.cancelar(String(req.params.id), { adminId: adminId(req) }));
  } catch (e) {
    next(e);
  }
});

reservaRoutes.patch('/:id/reprogramar', authAny, validate(reprogramarSchema), async (req, res, next) => {
  try {
    res.json(
      await reservaService.reprogramar(
        String(req.params.id),
        { adminId: adminId(req) },
        (req as any).valid.body,
      ),
    );
  } catch (e) {
    next(e);
  }
});

reservaRoutes.get('/:id/cobros', authJwt, async (req, res, next) => {
  try {
    res.json(await cobroService.listByReserva(String(req.params.id)));
  } catch (e) {
    next(e);
  }
});

reservaRoutes.post('/:id/cobros', authJwt, validate(crearCobroSchema), async (req, res, next) => {
  try {
    const me = req.principal?.kind === 'admin' ? req.principal.adminId : null;
    const out = await cobroService.crear(String(req.params.id), (req as any).valid.body, me);
    await auditService.log(req, {
      accion: 'CREAR',
      entidad: 'Cobro',
      entidadId: out.cobro.id,
      descripcion: 'Registró un cobro de $' + out.cobro.monto.toLocaleString('es-AR') + ' (' + out.cobro.medio.toLowerCase() + ')',
    });
    res.status(201).json(out);
  } catch (e) {
    next(e);
  }
});
