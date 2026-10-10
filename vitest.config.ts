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
    ],
    // A run fails when a test leaves a file in the checkout that git neither tracks nor
    // ignores (#579): scripts/untracked-guard/guard.mjs says why and how to fix one.
    globalSetup: ['scripts/untracked-guard/global-setup.mjs'],
    setupFiles: ['scripts/untracked-guard/after-each-file.mjs'],
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
