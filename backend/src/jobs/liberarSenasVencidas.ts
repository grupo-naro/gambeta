import { reservaService } from '../services/reserva.service.js';
import { logger } from '../utils/logger.js';

/**
 * Cada cuánto se revisa. Con `SENA_TIMEOUT_MINUTOS = 30`, el horario se libera entre los
 * 30 y los 32 minutos.
 *
 * Es una constante a propósito, no una variable de entorno: `SENA_TIMEOUT_MINUTOS` ya es la
 * perilla que decide el negocio, y `docker-compose.vm.yml` enumera las variables una por una
 * —una que no esté declarada ahí llega vacía al contenedor sin avisar, que es exactamente
 * cómo se rompió Mercado Pago—.
 */
export const INTERVALO_MS = 2 * 60 * 1000;

/**
 * Una pasada: cancela las reservas cuya ventana de seña venció y devuelve cuántas liberó.
 *
 * Existe porque Gambeteando no despliega n8n. En canchitas, el workflow
 * `canchitas-timeout-se-a` pegaba a `GET /reservas/vencidas-sena` y después a
 * `PATCH /reservas/:id/rechazar-sena`; acá no hay nada externo que lo haga, y una reserva
 * abandonada en ESPERANDO_SENA sigue bloqueando el horario porque la restricción de
 * exclusión de Postgres la cuenta como ocupada.
 */
export async function liberarSenasVencidas(): Promise<number> {
  const vencidas = await reservaService.vencidasSena();
  let liberadas = 0;
  for (const r of vencidas) {
    try {
      // Sin adminId: queda registrado como verificadoPor 'IA', igual que lo dejaba n8n.
      // Devuelve null si la aprobaron entre el listado y esta línea; ahí no se toca.
      if (await reservaService.rechazarSena(r.id, {})) liberadas++;
    } catch (e) {
      // Una reserva que falla no puede frenar a las demás.
      logger.warn({ err: e, reservaId: r.id }, 'no se pudo liberar una reserva con seña vencida');
    }
  }
  if (liberadas > 0) logger.info({ liberadas }, 'reservas con seña vencida liberadas');
  return liberadas;
}

/**
 * Programa el job. Llamar SOLO desde `index.ts`, nunca desde `buildApp()`: los tests
 * construyen la app y un temporizador cancelando reservas de fondo los volvería intermitentes.
 */
export function iniciarJobSenasVencidas(): NodeJS.Timeout {
  const timer = setInterval(() => {
    liberarSenasVencidas().catch((e) => logger.error({ err: e }, 'falló la pasada del job de señas vencidas'));
  }, INTERVALO_MS);
  timer.unref(); // que no sea el temporizador lo que mantenga vivo al proceso
  return timer;
}
