/**
 * Interruptores de funcionalidades que existen en el código pero están apagadas.
 *
 * No son variables de entorno a propósito: `docker-compose.vm.yml` enumera las variables que
 * entran al contenedor, así que una env nueva que no se declare ahí queda vacía en producción
 * sin avisar. Para un interruptor que casi no cambia, una constante es más segura.
 */

/**
 * Socios (suscripciones mensuales bonificadas).
 *
 * **Apagado**: el complejo maneja a los socios con turnos fijos, no con suscripciones.
 *
 * Con esto en `false`, `suscripcionService.vigenteDe()` devuelve siempre `null`, así que ninguna
 * reserva nueva nace bonificada. El código, las rutas y los datos quedan intactos: las
 * suscripciones que estén en la base siguen ahí sin aplicar, y las reservas históricas que se
 * crearon bonificadas conservan su `suscripcionId` y su monto en 0, porque eso fue lo que
 * realmente pasó y la caja tiene que seguir cerrando contra el histórico.
 *
 * Para reactivarlo: poner `true` acá y volver a mostrar la sección "Socios" en el panel
 * (`frontend/src/lib/features.ts`).
 */
export const SOCIOS_HABILITADO = false;
