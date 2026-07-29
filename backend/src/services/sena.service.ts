import { configService } from './config.service.js';

export interface DatosPago {
  modo: 'fijo';
  porcentaje: number;
  cbu: string;
  alias: string;
  titular: string;
}

export const senaService = {
  /** Seña de una cancha: su monto propio si está seteado (>0), si no el monto fijo global. */
  async montoParaCancha(cancha: { senaMonto?: unknown }, precioHora: number): Promise<number> {
    const propio = cancha?.senaMonto == null ? 0 : Number(cancha.senaMonto);
    if (propio > 0) return Math.round(propio);
    return this.montoParaPrecio(precioHora);
  },
  /** Fallback global: siempre monto fijo (el porcentaje quedó anulado). */
  async montoParaPrecio(_precioHora: number): Promise<number> {
    const c = await configService.get();
    return Math.round(Number(c.senaMontoFijo));
  },
  async datosPago(): Promise<DatosPago> {
    const c = await configService.get();
    return { modo: 'fijo', porcentaje: c.senaPorcentaje, cbu: c.cbu, alias: c.alias, titular: c.titular };
  },
};
