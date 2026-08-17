/**
 * The bundle-split contract for `boardsmith/ui/dice`, proven on a FRESH module
 * graph: a game that never imports the dice module has no die renderer at all
 * (and therefore no three.js), and importing the module is itself what
 * registers one — there is no separate call a game could forget.
 *
 * This lives in its own file ON PURPOSE. `vi.resetModules()` makes every later
 * dynamic import in the same file resolve to a fresh module instance, which
 * silently breaks any sibling test that compares module-singleton identity.
 * Keeping it isolated means the reset cannot reach another test.
 */
import { describe, it, expect, vi } from 'vitest';

describe('die preview registry on a fresh module graph', () => {
  it('starts empty, and importing the dice module registers the renderer', async () => {
    vi.resetModules();

    const registry = await import('./die-preview-registry.js');
    expect(registry.getDiePreviewComponent()).toBeNull();

    const dice = await import('./index.js');
    expect(registry.getDiePreviewComponent()).toBe(dice.Die3D);
  });

  it('registers the async wrapper, so three.js stays in its own lazy chunk', async () => {
    vi.resetModules();

    const registry = await import('./die-preview-registry.js');
    await import('./index.js');

    const registered = registry.getDiePreviewComponent() as { __asyncLoader?: unknown } | null;
    expect(registered).not.toBeNull();
    // Registering the SFC directly instead of the async wrapper would pull
    // three.js back into the eager graph of every game that renders dice.
    expect(registered!.__asyncLoader).toBeTypeOf('function');
  });
});
