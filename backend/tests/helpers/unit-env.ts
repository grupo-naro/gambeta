/**
 * Setup file de `vitest.unit.config.ts`. Los tests unitarios (a diferencia de los de
 * integración) NO levantan Testcontainers ni corren `tests/helpers/global-setup.ts` — así que,
 * a menos que algo más los ponga, los campos SIN `.default()` del schema de
 * `src/config/env.ts` (`DATABASE_URL`, `JWT_SECRET`, `SERVICE_API_KEY`, `ADMIN_SEED_EMAIL`,
 * `ADMIN_SEED_PASSWORD`) llegan `undefined` a `process.env`.
 *
 * `getEnv()` cachea el resultado de `parseEnv(process.env)` en un singleton de módulo la
 * primera vez que se llama en el proceso. Como `vitest.unit.config.ts` corre TODOS los archivos
 * de test en un único proceso (`singleFork: true`, `fileParallelism: false`), el primer archivo
 * del run que dispare una llamada real (no mockeada) a `getEnv()` sin esos campos ya seteados
 * revienta con un `ZodError` — y como el resultado queda cacheado, cualquier archivo posterior
 * que dependa de esa misma instancia de `env.ts` hereda el mismo problema. Esto no es exclusivo
 * de un archivo: le pasa a cualquiera que toque `getEnv()` real sin mockearlo (ver el comentario
 * de `tests/unit/mercadopago-firma.test.ts`, que documenta el mismo problema y lo resuelve
 * mockeando `getEnv()` puntualmente).
 *
 * Este setup file les da a TODOS los archivos unitarios una base válida antes de que corra
 * su primer test, para que ninguno dependa del orden en que vitest los ejecute ni de que algún
 * otro archivo ya haya "calentado" el env por su cuenta. Usa `||=` (no asignación directa) para
 * no pisar lo que un archivo puntual necesite setear distinto a propósito (ver
 * `tests/unit/precio.service.test.ts`, que ya usa el mismo patrón con `TZ_NEGOCIO`).
 *
 * Ninguno de estos valores toca una base real: `DATABASE_URL` nunca se usa para conectar en
 * los tests unitarios (eso es justamente lo que los distingue de los de integración), el schema
 * solo exige que sea un string no vacío.
 *
 * OJO al tocar `JWT_SECRET` / `SERVICE_API_KEY` / `ADMIN_SEED_PASSWORD`: coinciden a propósito
 * con los mismos literales de `tests/helpers/global-setup.ts` (el equivalente para tests de
 * integración). No hay nada que los obligue a coincidir — cada archivo de test corre bajo UNA
 * sola de las dos configs, nunca bajo ambas a la vez — pero `tests/unit/auth.test.ts` (entre
 * otros) asume ese valor concreto (`'svc'`) al leer `process.env.SERVICE_API_KEY` directo, sin
 * mockear `getEnv()`. Si estos literales divergen entre los dos archivos, un test que hoy pasa
 * en las dos configs puede empezar a fallar en una sola, y el motivo real (un `SERVICE_API_KEY`
 * distinto) va a quedar escondido detrás de un fallo que no tiene pinta de estar relacionado.
 */
process.env.DATABASE_URL ||= 'postgresql://unit-test-placeholder';
process.env.JWT_SECRET ||= 'a'.repeat(32);
process.env.SERVICE_API_KEY ||= 'svc';
process.env.ADMIN_SEED_EMAIL ||= 'admin@unit-test.local';
process.env.ADMIN_SEED_PASSWORD ||= 'pw';
