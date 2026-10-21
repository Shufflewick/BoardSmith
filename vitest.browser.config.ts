import { defineConfig } from 'vitest/config';

/**
 * `boardsmith test --browser`: every browser regression in `scripts/*-browser.mjs`, each run in
 * Chromium (#533). Kept apart from `vitest.config.ts` so the default suite needs no browser;
 * only `agent-policy merge` runs it, on the paths its `browser` step in `.agent-policy.json` names.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/browser-regressions.browser-test.mjs'],
    // A run fails when a test leaves a file in the checkout that git neither tracks nor
    // ignores (#579): scripts/untracked-guard/guard.mjs says why and how to fix one.
    globalSetup: ['scripts/untracked-guard/global-setup.mjs'],
    setupFiles: ['scripts/untracked-guard/after-each-file.mjs'],
  },
});
