import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerRenderer, resolveRenderer, resetRegistry } from './renderer-registry.js';
import type { RendererEntry } from './renderer-registry.js';

// ---------------------------------------------------------------------------
// Minimal GameElement interface for test factories (mirrors renderer-registry.ts)
// ---------------------------------------------------------------------------
interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------
function buildElement(attributes: Record<string, unknown> = {}): GameElement {
  return { id: 1, className: 'Space', name: 'test', attributes, children: [] };
}

// Stub Vue components — plain objects with a name field are sufficient stand-ins
const StubComponentA = { name: 'StubComponentA' };
const StubComponentB = { name: 'StubComponentB' };
const StubComponentC = { name: 'StubComponentC' };

// ---------------------------------------------------------------------------
// resolveRenderer
// ---------------------------------------------------------------------------
describe('resolveRenderer', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('returns null when registry is empty', () => {
    const element = buildElement();
    expect(resolveRenderer(element)).toBeNull();
  });

  it('returns highest-priority component when two entries match', () => {
    const entry5: RendererEntry = {
      test: () => 5,
      component: StubComponentA as any,
    };
    const entry100: RendererEntry = {
      test: () => 100,
      component: StubComponentB as any,
    };
    registerRenderer(entry5);
    registerRenderer(entry100);

    const element = buildElement();
    expect(resolveRenderer(element)).toBe(StubComponentB);
  });

  it('skips entries whose test() returns -1', () => {
    const notApplicable: RendererEntry = {
      test: () => -1,
      component: StubComponentA as any,
    };
    registerRenderer(notApplicable);

    const element = buildElement();
    expect(resolveRenderer(element)).toBeNull();
  });

  it('returns null when ALL entries return -1', () => {
    registerRenderer({ test: () => -1, component: StubComponentA as any });
    registerRenderer({ test: () => -1, component: StubComponentB as any });

    const element = buildElement();
    expect(resolveRenderer(element)).toBeNull();
  });

  it('treats a throwing test() as -1, warns, and still resolves from other entries', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const throwingEntry: RendererEntry = {
      test: () => { throw new Error('test blew up'); },
      component: StubComponentA as any,
    };
    const goodEntry: RendererEntry = {
      test: () => 5,
      component: StubComponentB as any,
    };
    registerRenderer(throwingEntry);
    registerRenderer(goodEntry);

    const element = buildElement();
    const result = resolveRenderer(element);

    expect(result).toBe(StubComponentB);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('consumer priority 100+ overrides built-in at priority 1-10', () => {
    const builtIn: RendererEntry = {
      test: () => 5,
      component: StubComponentA as any,
    };
    const consumerOverride: RendererEntry = {
      test: () => 100,
      component: StubComponentC as any,
    };
    registerRenderer(builtIn);
    registerRenderer(consumerOverride);

    const element = buildElement();
    expect(resolveRenderer(element)).toBe(StubComponentC);
  });
});

// ---------------------------------------------------------------------------
// resetRegistry (test-only helper)
// ---------------------------------------------------------------------------
describe('resetRegistry', () => {
  it('empties the registry so resolveRenderer returns null afterward', () => {
    registerRenderer({ test: () => 5, component: StubComponentA as any });
    resetRegistry();
    const element = buildElement();
    expect(resolveRenderer(element)).toBeNull();
  });
});
