import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

let container: StartedPostgreSqlContainer;

export async function setup() {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('gambeteando')
    .start();

  const url = container.getConnectionUri();

  // Set env vars in the main process — forks inherit these.
  // OJO: JWT_SECRET / SERVICE_API_KEY / ADMIN_SEED_PASSWORD usan los mismos literales que
  // tests/helpers/unit-env.ts (el equivalente para tests unitarios, sin Testcontainers). Nada
  // los obliga a coincidir en código, pero algunos tests (ver tests/unit/auth.test.ts, que lee
  // process.env.SERVICE_API_KEY directo) asumen ese valor concreto y corren bajo las dos
  // configs. Si divergen, un test puede empezar a fallar en una sola config con un mensaje que
  // no da ninguna pista de por qué.
  process.env['DATABASE_URL'] = url;
  process.env['JWT_SECRET'] = 'a'.repeat(32);
  process.env['JWT_EXPIRES_IN'] = '12h';
  process.env['SERVICE_API_KEY'] = 'svc';
  process.env['BUFFET_API_KEY'] = 'buffet-key-de-tests-por-defecto';
  process.env['TZ_NEGOCIO'] = 'America/Argentina/Buenos_Aires';
  process.env['CANCELACION_ANTICIPACION_MINUTOS'] = '10';
  process.env['SENA_TIMEOUT_MINUTOS'] = '30';
  process.env['SENA_MODO'] = 'porcentaje';
  process.env['SENA_PORCENTAJE'] = '50';
  process.env['SENA_MONTO_FIJO'] = '5000';
  process.env['SENA_CBU'] = '0000003100000000000001';
  process.env['SENA_ALIAS'] = 'gambeteando.canchas';
  process.env['SENA_TITULAR'] = 'Gambeteando';
  process.env['ADMIN_SEED_EMAIL'] = 'admin@gambeteando.com';
  process.env['ADMIN_SEED_PASSWORD'] = 'pw';

  // Apply migrations to the container.
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
    cwd: ROOT,
  });
}

export async function teardown() {
  await container?.stop();
}
