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
  },
});
