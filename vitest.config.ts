import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts', // Colocated library tests
      'packages/games/**/tests/**/*.test.ts', // Game tests (until Phase 44)
      'cli/tests/**/*.test.ts', // CLI tests
    ],
  },
});
