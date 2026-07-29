import { logger } from '../../utils/logger.js';
import { estaConfigurado, escribirDia } from './sheetsClient.js';
import { dataSemana, diasSemanaActual } from './sheetsData.js';
import { construirGrillaDia } from './grilla.js';

const timers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 2500;

async function reconstruirDia(fecha: string): Promise<void> {
  const { dias, horas, canchas, celdas } = await dataSemana();
  const dia = dias.find((d) => d.fecha === fecha);
  if (!dia) return; // fecha fuera de la semana actual: no se refleja
  const g = construirGrillaDia(horas, canchas, celdas.filter((c) => c.fecha === fecha));
  await escribirDia(dia.dia, dia.fecha, g);
}

export const sheetsSync = {
  async sincronizarTodo(): Promise<void> {
    if (!estaConfigurado()) return;
    const { dias, horas, canchas, celdas } = await dataSemana();
    for (const d of dias) {
      const g = construirGrillaDia(horas, canchas, celdas.filter((c) => c.fecha === d.fecha));
      await escribirDia(d.dia, d.fecha, g);
    }
  },
  /** Marca sucios los 7 días de la semana actual (fijos/bloqueos afectan toda la semana). */
  marcarSemanaSucia(): void {
    if (!estaConfigurado()) return;
    for (const d of diasSemanaActual()) this.marcarSucio(d.fecha);
  },
  /** Best-effort, no bloqueante, con debounce por fecha. Nunca lanza. */
  marcarSucio(fecha: string): void {
    if (!estaConfigurado() || !fecha) return;
    const prev = timers.get(fecha);
    if (prev) clearTimeout(prev);
    timers.set(fecha, setTimeout(() => {
      timers.delete(fecha);
      reconstruirDia(fecha).catch((e) => logger.warn({ err: String(e) }, 'sheets sync falló'));
    }, DEBOUNCE_MS));
  },
};
