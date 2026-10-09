// @vitest-environment jsdom
/**
 * TOOL-03 (D19, Blocking) regression: `boardsmith/ui` used to read
 * `window.matchMedia(...)` at MODULE SCOPE (it is now deferred to the first
 * read of `prefersReducedMotion`, in `reducedMotion.ts`).
 * jsdom implements `window` but NOT `matchMedia`, so importing the
 * `boardsmith/ui` barrel under jsdom throws unless the caller manually
 * stubs `matchMedia` first — games can't test UI under jsdom without that
 * shim. This file deliberately installs NO `vi.stubGlobal('matchMedia', ...)`
 * — that absence is the entire point of the regression test.
 */
import { describe, it, expect } from 'vitest';

// Loaded while the file is collected, where no test timeout applies (#365):
// the barrel compiles every UI module, which takes seconds on a busy machine.
// There is no per-test setup to run first, and the rejection is kept rather
// than thrown, so a throwing import still fails the first test below by name
// instead of failing collection.
const barrel: { module?: typeof import('../index.js'); error?: unknown } = await import('../index.js').then(
  (module) => ({ module }),
  (error: unknown) => ({ error }),
);

describe('boardsmith/ui barrel import — TOOL-03 (D19): side-effect-free under jsdom', () => {
  it('imports the ui barrel under jsdom with no matchMedia stub without throwing', () => {
    expect(barrel.error).toBeUndefined();
    expect(barrel.module).toBeDefined();
  });

  it('prefersReducedMotion is defined on the barrel after a no-stub import', () => {
    expect(barrel.module?.prefersReducedMotion).toBeDefined();
  });

  it('no longer exports the removed animation composables (#505)', () => {
    const exported = Object.keys(barrel.module ?? {});
    expect(exported).toContain('prefersReducedMotion');
    for (const removed of ['useElementAnimation', 'useElementChangeTracker', 'useCountTracker']) {
      expect(exported).not.toContain(removed);
    }
  });

  it('prefersReducedMotion lives in its own module and the barrel re-exports that same ref (#505)', async () => {
    // Dynamic import: the module under test is the new home, checked for identity with the barrel's export.
    const home = await import('./reducedMotion.js');
    expect(barrel.module?.prefersReducedMotion).toBe(home.prefersReducedMotion);
  });
});
