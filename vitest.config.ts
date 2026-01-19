import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

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
  resolve: {
    alias: {
      // Game rules packages (still in packages/ until Phase 44)
      '@boardsmith/checkers-rules': resolve(__dirname, 'packages/games/checkers/rules/src/index.ts'),
      '@boardsmith/cribbage-rules': resolve(__dirname, 'packages/games/cribbage/rules/src/index.ts'),
      '@boardsmith/go-fish-rules': resolve(__dirname, 'packages/games/go-fish/rules/src/index.ts'),
    },
  },
});
