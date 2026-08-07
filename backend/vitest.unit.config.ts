import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    singleFork: true,
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    passWithNoTests: true,
    // Da una base válida de env vars requeridas (ver tests/helpers/unit-env.ts) antes de que
    // corra cualquier test: sin esto, el primer archivo que llame a getEnv() real sin mockear
    // revienta por campos sin default (DATABASE_URL, JWT_SECRET, etc.), y como getEnv() cachea
    // el resultado, arrastra el problema a los archivos siguientes del mismo proceso.
    setupFiles: ['tests/helpers/unit-env.ts'],
  },
});
