import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
    ],
    exclude: [
      'node_modules',
      'dist',
      // Exclude tests that depend on external game packages not in this repo
      'src/ai/mcts-bot.test.ts',
      'src/ai/mcts-cache.test.ts',
      'src/ai/cribbage-bot.test.ts',
      'src/ai-trainer/parallel-simulator.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@boardsmith/engine': resolve(__dirname, 'src/engine/index.ts'),
      '@boardsmith/runtime': resolve(__dirname, 'src/runtime/index.ts'),
      '@boardsmith/ai': resolve(__dirname, 'src/ai/index.ts'),
      '@boardsmith/ai-trainer': resolve(__dirname, 'src/ai-trainer/index.ts'),
      '@boardsmith/session': resolve(__dirname, 'src/session/index.ts'),
      '@boardsmith/ui': resolve(__dirname, 'src/ui/index.ts'),
      '@boardsmith/testing': resolve(__dirname, 'src/testing/index.ts'),
    },
  },
});
