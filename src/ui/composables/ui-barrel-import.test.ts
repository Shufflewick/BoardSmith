// @vitest-environment jsdom
/**
 * TOOL-03 (D19, Blocking) regression: `boardsmith/ui` reads
 * `window.matchMedia(...)` at MODULE SCOPE (`useElementAnimation.ts:36-48`).
 * jsdom implements `window` but NOT `matchMedia`, so importing the
 * `boardsmith/ui` barrel under jsdom throws unless the caller manually
 * stubs `matchMedia` first — games can't test UI under jsdom without that
 * shim. This file deliberately installs NO `vi.stubGlobal('matchMedia', ...)`
 * — that absence is the entire point of the regression test.
 */
import { describe, it, expect } from 'vitest';

describe('boardsmith/ui barrel import — TOOL-03 (D19): side-effect-free under jsdom', () => {
  it('imports the ui barrel under jsdom with no matchMedia stub without throwing', async () => {
    // Dynamic import: a static top-level import would be hoisted ahead of
    // any per-test setup regardless of source order, and would also make
    // vitest's own module-collection phase eat the throw before the `it`
    // block ever runs, deopting the RED signal.
    await expect(import('../index.js')).resolves.toBeDefined();
  });

  it('prefersReducedMotion is defined on the barrel after a no-stub import', async () => {
    const mod = await import('../index.js');
    expect(mod.prefersReducedMotion).toBeDefined();
  });
});
