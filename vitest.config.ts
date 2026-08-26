import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'docs/**/*.test.ts',
      'scripts/**/*.test.mjs',
    ],
    exclude: [
      'node_modules',
      'dist',
      // Exclude tests that depend on external game packages not in this repo
      'src/bot/mcts-bot.test.ts',
      'src/bot/mcts-cache.test.ts',
      'src/bot/mcts-stats-checkers.test.ts',
      'src/bot/cribbage-bot.test.ts',
      'src/bot-trainer/parallel-simulator.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@boardsmith/engine': resolve(__dirname, 'src/engine/index.ts'),
      '@boardsmith/runtime': resolve(__dirname, 'src/runtime/index.ts'),
      '@boardsmith/bot': resolve(__dirname, 'src/bot/index.ts'),
      '@boardsmith/bot-trainer': resolve(__dirname, 'src/bot-trainer/index.ts'),
      '@boardsmith/session': resolve(__dirname, 'src/session/index.ts'),
      '@boardsmith/ui': resolve(__dirname, 'src/ui/index.ts'),
      '@boardsmith/testing': resolve(__dirname, 'src/testing/index.ts'),
    },
  },
});
