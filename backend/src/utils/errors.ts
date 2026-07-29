export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const BadRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const Unauthorized = (message = 'No autorizado') => new AppError(401, 'UNAUTHORIZED', message);
export const Forbidden = (message = 'Prohibido') => new AppError(403, 'FORBIDDEN', message);
export const UsuarioVencido = (message = 'Usuario vencido') => new AppError(403, 'USUARIO_VENCIDO', message);
export const NotFound = (entidad: string, id?: string) => new AppError(404, 'NOT_FOUND', `${entidad} no encontrado${id ? `: ${id}` : ''}`);
export const Conflict = (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details);
export const BusinessRule = (message: string, details?: unknown) => new AppError(422, 'BUSINESS_RULE', message, details);
export const ServiceUnavailable = (message = 'No disponible') => new AppError(503, 'SERVICE_UNAVAILABLE', message);
