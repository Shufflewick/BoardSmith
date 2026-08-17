/**
 * The three-free half of `boardsmith/ui/dice`: the per-UI-tree animation
 * context (so two boards do not share "already animated" bookkeeping) and the
 * die-preview registry that keeps three.js out of games without dice.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  DIE_ANIMATION_CONTEXT_KEY,
  createDieAnimationContext,
} from './die3d-state.js';
import { getDiePreviewComponent, setDiePreviewComponent } from './die-preview-registry.js';

describe('createDieAnimationContext', () => {
  it('starts with no dice recorded as animated', () => {
    expect(createDieAnimationContext().animatedRollCounts.size).toBe(0);
  });

  it('tracks a roll count per die id', () => {
    const context = createDieAnimationContext();
    context.animatedRollCounts.set(7, 2);
    context.animatedRollCounts.set('die-a', 1);
    expect(context.animatedRollCounts.get(7)).toBe(2);
    expect(context.animatedRollCounts.get('die-a')).toBe(1);
  });

  it('gives each UI tree its own bookkeeping', () => {
    const first = createDieAnimationContext();
    const second = createDieAnimationContext();
    first.animatedRollCounts.set(1, 5);
    expect(second.animatedRollCounts.has(1)).toBe(false);
    expect(first.animatedRollCounts).not.toBe(second.animatedRollCounts);
  });
});

describe('DIE_ANIMATION_CONTEXT_KEY', () => {
  it('is a symbol, so provide/inject cannot collide with a string key', () => {
    expect(typeof DIE_ANIMATION_CONTEXT_KEY).toBe('symbol');
  });

  it('is a single module-wide instance, not one per importer', async () => {
    // The hazard this guards is a DUPLICATED module in the graph (this repo has
    // shipped two copies of a dependency before): two copies would mint two
    // Symbols, and provide/inject would silently stop matching.
    //
    // No vi.resetModules() anywhere in this file — that lives in
    // die-preview-registry.fresh.test.ts, because resetting the registry makes
    // every later dynamic import in the same file return a fresh module, which
    // turned this assertion into an order-dependent flake.
    const again = await import('./die3d-state.js');
    expect(again.DIE_ANIMATION_CONTEXT_KEY).toBe(DIE_ANIMATION_CONTEXT_KEY);
  });

  it('describes itself, so Vue devtools shows a readable injection', () => {
    expect(String(DIE_ANIMATION_CONTEXT_KEY)).toContain('dieAnimationContext');
  });
});

describe('die preview registry', () => {
  // The registry is a module singleton shared with every other test in this
  // worker, so whatever a test registers has to be put back.
  const originalComponent = getDiePreviewComponent();

  afterEach(() => {
    setDiePreviewComponent(originalComponent as never);
  });

  it('returns whatever was registered', () => {
    const component = { name: 'FakeDie' };
    setDiePreviewComponent(component);
    expect(getDiePreviewComponent()).toBe(component);
  });

  it('a later registration replaces the earlier one', () => {
    setDiePreviewComponent({ name: 'First' });
    const second = { name: 'Second' };
    setDiePreviewComponent(second);
    expect(getDiePreviewComponent()).toBe(second);
  });

  it('exposes Die3D as an async component, so three.js stays in its own chunk', async () => {
    const dice = await import('./index.js');
    expect(dice.Die3D).toBeTypeOf('object');
    expect((dice.Die3D as { __asyncLoader?: unknown }).__asyncLoader).toBeTypeOf('function');
  });
});
