export type EstadoReserva = 'CONFIRMADA' | 'ESPERANDO_SENA' | 'CANCELADA' | 'COMPLETADA';
export type Rol = 'ADMIN' | 'RECEPCIONISTA';

export interface Cancha { id: string; nombre: string; tipo: string; jugadores: number; destacada: boolean; precioHora: number; precioHoraPico: number; senaMonto?: string | number | null; activa: boolean; grupoId: string | null; esEntera: boolean }
export interface Cliente { id: string; nombre: string; whatsapp: string; confiable: boolean; totalReservas: number; cumplidas: number; confianza: boolean }
export interface Reserva {
  id: string; canchaId: string; clienteId: string;
  fechaInicio: string; fechaFin: string; estado: EstadoReserva;
  esContacto: boolean; monto: number; montoSena: number | null;
  pagado: number; saldo: number;
  turnoFijoId?: string | null;
  suscripcionId?: string | null;
  montoLista?: number | null;
  /** Hasta cuándo está pago el abono del fijo que originó esta reserva. */
  abonoHasta?: string | null;
  cancha: Pick<Cancha, 'id' | 'nombre'>; cliente: Cliente;
}
export interface DuracionSlot { min: number; horaFin: string; precio: number }
export interface Slot { horaInicio: string; inicioUtc: string; duraciones?: DuracionSlot[] }
export interface LoginResult { token: string; admin: { id: string; email: string; nombre: string; rol: Rol } }
export interface Usuario { id: string; email: string; nombre: string; rol: Rol; esDefault: boolean; expiraEn: string | null }

export type EstadoSuscripcionVista = 'ACTIVA' | 'VENCIDA' | 'CANCELADA';
export interface Suscripcion {
  id: string;
  clienteId: string;
  cliente: { id: string; nombre: string; whatsapp: string };
  inicio: string;
  vencimiento: string;
  estado: 'ACTIVA' | 'CANCELADA';
  estadoVista: EstadoSuscripcionVista;
  precio: number | null;
  nota: string | null;
  turnosBonificados: number;
  creadoEn: string;
}

export interface Config {
  id: string;
  horaApertura: string; horaCierre: string;
  horaAperturaFinde: string; horaCierreFinde: string;
  adminWhatsapp: string;
  senaModo: 'PORCENTAJE' | 'FIJO';
  senaPorcentaje: number; senaMontoFijo: number | string;
  cbu: string; alias: string; titular: string;
  alias2?: string; cbu2?: string; titular2?: string;
  picoDesde: string; picoHasta: string; picoFindeDesde: string; picoFindeHasta: string;
}

export interface TurnoFijo {
  id: string; canchaId: string; clienteNombre: string; whatsapp: string | null;
  diaSemana: number; horaInicio: string; horaFin: string; precio: number | string; activo: boolean;
  cancha?: { nombre: string }; excepciones?: { id: string; fecha: string }[];
  vigenciaDesde?: string | null;
  vigenciaHasta?: string | null;
  montoAbono?: number | null;
}
export type MotivoBloqueo = 'TORNEO' | 'ENTRENAMIENTO' | 'MANTENIMIENTO' | 'OTRO';
export interface Bloqueo {
  id: string; canchaId: string; motivo: MotivoBloqueo; recurrente: boolean;
  diaSemana: number | null; fecha: string | null; horaInicio: string; horaFin: string; nota: string | null;
  cancha?: { nombre: string }; excepciones?: { id: string; fecha: string }[];
}

export interface FijoAgenda {
  turnoFijoId: string; canchaId: string; cancha: { nombre: string };
  clienteNombre: string; whatsapp: string | null;
  horaInicio: string; horaFin: string; precio: number;
  /** Hasta cuándo está pago el abono de este fijo (mismo criterio que Reserva.abonoHasta). */
  abonoHasta: string | null;
  conAbono: boolean;
}
export interface AgendaDia { reservas: Reserva[]; fijos: FijoAgenda[]; bloqueos: Bloqueo[]; }

export interface LogActividad { id: string; creadoEn: string; usuario: string; accion: string; entidad: string; descripcion: string }

export type MedioPago = 'EFECTIVO' | 'TRANSFERENCIA';
export interface Cobro { id: string; monto: number; medio: MedioPago; origen: string; registradoPor: string; creadoEn: string }
export interface CobrosReserva { monto: number; pagado: number; saldo: number; cobros: Cobro[] }
export interface CajaReporte {
  desde: string; hasta: string; total: number;
  porMedio: { EFECTIVO: number; TRANSFERENCIA: number };
  porConcepto: { turnos: number; cuotas: number; abonos: number };
  porCancha: { canchaId: string; nombre: string; total: number }[];
  cobros: { id: string; creadoEn: string; monto: number; medio: MedioPago; concepto: 'TURNO' | 'CUOTA' | 'ABONO'; cancha: string; cliente: string; registradoPor: string }[];
}

export interface SheetsInfo { configurado: boolean; url: string | null }

export interface IngresoDia { fecha: string; total: number }
export interface OcupacionCelda { dia: number; hora: number; reservas: number }
export interface HorarioPico { hora: number; reservas: number }

// Thrown by apiFetch on non-2xx (except 401, which throws ApiAuthError).
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); this.name = 'ApiError'; } }
export class ApiAuthError extends ApiError { constructor(message = 'No autorizado') { super(401, message); this.name = 'ApiAuthError'; } }

export interface ProductoBuffet {
  id: string; nombre: string; codigoBarra: string | null; precio: number;
  stock: number; stockMinimo: number; enBotonera: boolean; orden: number; activo: boolean;
}
export interface TicketLineaBuffet { productoId: string; nombre: string; cantidad: number; precioUnit: number }
export interface TicketBuffet { id: string; total: number; medioPago: MedioPago; vuelto: number; creadoEn: string; lineas: TicketLineaBuffet[] }
export interface CajaBuffetEstado {
  id: string; abiertaEn: string;
  totalUnidades: number; totalMonto: number; totalEfectivo: number; totalTransferencia: number;
  ultimosTickets: TicketBuffet[];
}
export interface LineaCierreBuffet { productoId: string; nombre: string; unidades: number; monto: number }
export interface CierreBuffet {
  id: string; abiertaEn: string; cerradaEn: string;
  totalUnidades: number; totalMonto: number; totalEfectivo: number; totalTransferencia: number;
  porProducto: LineaCierreBuffet[];
}
export interface ProductoCobro { id: string; nombre: string; precio: number }
export interface CobroResultado { ticketId: string; total: number; vuelto: number; medioPago: MedioPago; caja: CajaBuffetEstado }
