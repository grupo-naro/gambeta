export type EstadoReserva = 'CONFIRMADA' | 'ESPERANDO_SENA' | 'CANCELADA' | 'COMPLETADA';
export type Rol = 'ADMIN' | 'RECEPCIONISTA';

export interface Cancha {
  id: string; nombre: string; tipo: string; jugadores: number; destacada: boolean; precioHora: number; precioHoraPico: number; senaMonto?: string | number | null; activa: boolean; grupoId: string | null; esEntera: boolean;
  /** Precio propio por duración (1½ y 2 horas), banda base y pico. Opcionales: sin ellos, el precio se deriva proporcional al precio por hora. */
  precio90?: number | null;
  precio90Pico?: number | null;
  precio120?: number | null;
  precio120Pico?: number | null;
  /** Turnos en bloques fijos (minutos). null = agenda libre. Con valor, la cancha ofrece solo turnos de esa duración. */
  turnoBloqueMin?: number | null;
  /** Minutos desde la apertura hasta el primer turno de la cancha (escalonado). */
  turnoDesfaseMin?: number;
}
export interface Cliente { id: string; nombre: string; whatsapp: string; confiable: boolean; totalReservas: number; cumplidas: number; confianza: boolean }
export type MetodoSena = 'MERCADO_PAGO' | 'TRANSFERENCIA';
export interface Reserva {
  id: string; canchaId: string; clienteId: string;
  fechaInicio: string; fechaFin: string; estado: EstadoReserva;
  esContacto: boolean; monto: number; montoSena: number | null;
  /** Cómo dijo el cliente que iba a pagar la seña. Opcional: puede venir de un backend con skew de versión. */
  metodoSena?: MetodoSena | null;
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
  diasAnticipacionMax?: number;
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
  /** Nota libre del turno fijo (se copia a cada reserva que genera). */
  nota?: string | null;
  /** Lo cobrado del abono hasta ahora (null si el fijo no tiene abono). Saldo = montoAbono - abonoPagado. */
  abonoPagado?: number | null;
}
export type MotivoBloqueo = 'TORNEO' | 'ENTRENAMIENTO' | 'MANTENIMIENTO' | 'OTRO';
export interface Bloqueo {
  id: string; canchaId: string; motivo: MotivoBloqueo; recurrente: boolean;
  diaSemana: number | null; fecha: string | null; horaInicio: string; horaFin: string; nota: string | null;
  cancha?: { nombre: string }; excepciones?: { id: string; fecha: string }[];
  /** Período de un bloqueo recurrente ('YYYY-MM-DD', inclusivo; null = sin límite). */
  vigenciaDesde?: string | null;
  vigenciaHasta?: string | null;
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
export interface CuentaMp { vinculada: boolean; apodo: string | null; venceEn: string | null; caida: boolean }

export interface IngresoDia { fecha: string; total: number }
export interface OcupacionCelda { dia: number; hora: number; reservas: number }
export interface HorarioPico { hora: number; reservas: number }

// Thrown by apiFetch on non-2xx (except 401, which throws ApiAuthError).
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); this.name = 'ApiError'; } }
export class ApiAuthError extends ApiError { constructor(message = 'No autorizado') { super(401, message); this.name = 'ApiAuthError'; } }

export interface ProductoBuffet {
  id: string; nombre: string; codigoBarra: string | null; precio: number;
  stock: number; stockMinimo: number; enBotonera: boolean; orden: number; activo: boolean;
  /** Unidades de este producto que están en el mostrador secundario. */
  asignado: number;
}
export type TipoMostrador = 'PRINCIPAL' | 'SECUNDARIO';
export interface MostradorAdmin {
  id: string; nombre: string; tipo: TipoMostrador; activo: boolean;
  /** Si tiene PIN cargado. El hash nunca sale del backend. */
  tienePin: boolean;
}
/** Lo que devuelve `/buffet/pin/verificar`: quién es el mostrador y su token de sesión. */
export interface MostradorIdentificado { token: string; tipo: TipoMostrador; nombre: string }
export interface TicketLineaBuffet { productoId: string; nombre: string; cantidad: number; precioUnit: number }
export interface TicketBuffet { id: string; total: number; medioPago: MedioPago; vuelto: number; creadoEn: string; lineas: TicketLineaBuffet[] }
export interface CajaBuffetEstado {
  id: string; abiertaEn: string;
  totalUnidades: number; totalMonto: number; totalEfectivo: number; totalTransferencia: number;
  /** Cuánto de `totalMonto` vino de alquileres. */
  totalAlquileres: number;
  ultimosTickets: TicketBuffet[];
}
export interface LineaCierreBuffet { productoId: string; nombre: string; unidades: number; monto: number }
export interface LineaCierreAlquiler { articuloId: string; nombre: string; unidades: number; monto: number }
export interface CierreBuffet {
  id: string; abiertaEn: string; cerradaEn: string;
  mostradorId: string; mostradorNombre: string;
  totalUnidades: number; totalMonto: number; totalEfectivo: number; totalTransferencia: number;
  totalAlquileres: number;
  porProducto: LineaCierreBuffet[];
  porArticulo: LineaCierreAlquiler[];
}
export interface ProductoCobro { id: string; nombre: string; precio: number; stock: number }
export interface StockAsignado { productoId: string; cantidad: number }
export interface ConciliacionPendiente {
  cajaId: string; mostradorNombre: string; cerradaEn: string; totalMonto: number;
}
export interface LineaConciliacion {
  productoId: string; nombre: string; entregado: number; vendido: number; esperado: number;
}
export interface CobroResultado { ticketId: string; total: number; vuelto: number; medioPago: MedioPago; caja: CajaBuffetEstado }

export interface ResumenConciliacion {
  productoId: string; nombre: string; cierres: number;
  entregado: number; vendido: number; contado: number; diferencia: number;
}
export interface EntregaPanel {
  id: string; creadaEn: string; conciliada: boolean;
  lineas: { productoId: string; nombre: string; cantidad: number }[];
}

export interface ArticuloAlquiler {
  id: string; nombre: string; precio: number;
  stock: number; prestado: number; disponible: number;
  activo: boolean; orden: number;
}
export type EstadoAlquiler = 'ENTREGADO' | 'DEVUELTO' | 'PERDIDO' | 'ROTO';
export type EstadoCierreAlquiler = Exclude<EstadoAlquiler, 'ENTREGADO'>;
export interface Alquiler {
  id: string; articuloId: string; articuloNombre: string; cantidad: number;
  quienRetira: string; garantia: string | null;
  precioUnit: number; total: number; medioPago: MedioPago;
  estado: EstadoAlquiler; entregadoEn: string; cerradoEn: string | null;
}
export interface EntregaAlquilerResultado { alquiler: Alquiler; vuelto: number }

export type TipoOrigen = 'WHATSAPP' | 'QR' | 'REDES' | 'LANDING' | 'DIRECTO' | 'OTRO';
export interface OrigenPorTipo { tipo: TipoOrigen; visitas: number; unicos: number }
export interface OrigenPorEtiqueta extends OrigenPorTipo { etiqueta: string | null }
export interface Origenes {
  total: number;
  unicos: number;
  porTipo: OrigenPorTipo[];
  porEtiqueta: OrigenPorEtiqueta[];
}

export type EstadoCeldaDisp = 'libre' | 'ocupada' | 'conflicto';
export interface CeldaDisp { estado: EstadoCeldaDisp; detalle?: string; fechas?: string[] }
/** Lo que devuelve `/turnos-fijos/disponibilidad`: ¿entraría un fijo semanal en cada cancha y horario? */
export interface DisponibilidadSemanal {
  deporte: 'futbol' | 'padel'; diaSemana: number; duracionMin: number; semanas: number;
  horas: string[]; canchas: { id: string; nombre: string }[];
  celdas: Record<string, Record<string, CeldaDisp>>;
}

/** Lo que devuelve `/disponibilidad/grilla`: qué canchas están libres a cada hora de una fecha. */
export interface GrillaDisponibilidad {
  deporte: string; fecha: string;
  canchas: { id: string; nombre: string; precioHora: number }[];
  horas: string[];
  libres: Record<string, Record<string, boolean>>;
  precios: Record<string, Record<string, number>>;
  duraciones: Record<string, Record<string, DuracionSlot[]>>;
}

export type EstadoCuentaBuffet = 'ABIERTA' | 'RENDIDA' | 'CANCELADA' | 'IMPAGA';
export interface CuentaLinea { productoId: string; nombre: string; cantidad: number; precioUnit: number; subtotal: number }
/** Cuenta de consumos del buffet a nombre de una cancha (ver backend/src/services/buffetCuenta.service.ts). */
export interface CuentaBuffet {
  id: string; canchaId: string; canchaNombre: string; estado: EstadoCuentaBuffet;
  abiertaEn: string; cerradaEn: string | null;
  reserva: { clienteNombre: string; horaInicio: string; horaFin: string } | null;
  total: number; lineas: CuentaLinea[];
}
export interface CanchaMostrador { id: string; nombre: string }
export interface RendirCuentaResultado { cuenta: CuentaBuffet; ticketId: string; total: number; vuelto: number }
