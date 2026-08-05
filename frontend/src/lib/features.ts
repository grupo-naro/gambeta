/**
 * Interruptores de funcionalidades que existen en el código pero están apagadas.
 *
 * Tiene que coincidir con `backend/src/config/features.ts`: el panel y el backend se
 * deployan juntos, pero son proyectos separados y no comparten módulos.
 */

/**
 * Socios (suscripciones mensuales bonificadas).
 *
 * **Apagado**: el complejo maneja a los socios con turnos fijos, no con suscripciones.
 *
 * Acá solo controla la UI: oculta la sección "Socios" del menú y bloquea su página, para que
 * nadie cargue una suscripción que el backend ya no va a aplicar. El apagado de verdad está en
 * `backend/src/config/features.ts`, donde `vigenteDe()` devuelve `null`.
 *
 * Las reservas históricas que se crearon bonificadas siguen mostrando su chip de socio: eso fue
 * lo que realmente pasó y la caja tiene que cerrar contra el histórico.
 */
export const SOCIOS_HABILITADO = false;
