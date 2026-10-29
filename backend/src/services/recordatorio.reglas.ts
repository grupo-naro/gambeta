import { combineDateTimeUtc, sumarDias } from '../utils/tz.js';

/**
 * Hora (del negocio) a la que sale el recordatorio, el día anterior al turno. Es una constante a
 * propósito, no una variable de entorno: `docker-compose.prod.yml` enumera las variables una por
 * una y una que no esté declarada ahí llega vacía al contenedor sin avisar.
 */
export const HORA_RECORDATORIO = '18:00';

/**
 * El instante en que corresponde avisar de un turno: HORA_RECORDATORIO del día calendario anterior al
 * del turno. Un turno de madrugada cuenta por el día en que ocurre (el cliente piensa "el sábado"),
 * así que su aviso sale el viernes a las 18:00.
 */
export function momentoRecordatorio(fechaInicio: Date, tz: string): Date {
  const dia = fechaInicio.toLocaleDateString('en-CA', { timeZone: tz });
  return combineDateTimeUtc(sumarDias(dia, -1), HORA_RECORDATORIO, tz);
}
