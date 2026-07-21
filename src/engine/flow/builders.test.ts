import { describe, it, expect } from 'vitest';
import { loop, noop } from './builders.js';

describe('loop() — PIT-01 construction-time maxIterations guard', () => {
  it('throws an actionable error when maxIterations is omitted', () => {
    expect(() => loop({ do: noop() })).toThrow(/maxIterations/);
    expect(() => loop({ do: noop() })).toThrow(/loop\(\{ maxIterations: 100/);
    expect(() => loop({ do: noop() })).toThrow(/10000/);
  });

  it('constructs a valid loop FlowNode when maxIterations is provided', () => {
    const node = loop({ maxIterations: 10, do: noop() });
    expect(node.type).toBe('loop');
    expect((node.config as { maxIterations?: number }).maxIterations).toBe(10);
  });

  it('preserves while and name alongside maxIterations', () => {
    const whileFn = () => false;
    const node = loop({ name: 'my-loop', maxIterations: 5, while: whileFn, do: noop() });
    expect(node.type).toBe('loop');
    const config = node.config as { name?: string; while?: unknown; maxIterations?: number };
    expect(config.name).toBe('my-loop');
    expect(config.while).toBe(whileFn);
    expect(config.maxIterations).toBe(5);
  });
});

describe('loop() — LIBX-02 unbounded valve', () => {
  // Test A: `unbounded: true` makes maxIterations optional — construction must
  // NOT throw. This is the fail-on-pre-fix case: today's construction guard
  // throws unconditionally when maxIterations is undefined, regardless of an
  // `unbounded` flag (which does not exist yet on the config type).
  it('does NOT throw at construction when unbounded: true is provided without maxIterations', () => {
    expect(() => loop({ unbounded: true, do: noop() })).not.toThrow();

    const node = loop({ unbounded: true, do: noop() });
    expect(node.type).toBe('loop');
    expect((node.config as { unbounded?: boolean }).unbounded).toBe(true);
    expect((node.config as { maxIterations?: number }).maxIterations).toBeUndefined();
  });

  // Test B (no-regression, RESEARCH Pitfall 2): omitting BOTH maxIterations and
  // unbounded must still throw, and the message must name the unbounded valve
  // too (not just maxIterations) so authors discover the correct fix.
  it('still throws, naming both the bounded and unbounded valves, when neither is provided', () => {
    expect(() => loop({ do: noop() })).toThrow(/maxIterations/);
    expect(() => loop({ do: noop() })).toThrow(/unbounded/);
  });
});

describe('loop() — 164-IN-02 conflicting unbounded + maxIterations guard', () => {
  // Pre-fix: unbounded:true + an explicit maxIterations silently resolves to
  // the bounded behavior (maxIterations wins), with unbounded becoming a
  // no-op nothing tells the author about -- a plausible authoring mistake
  // (e.g. leftover maxIterations from before adding unbounded:true).
  it('throws an actionable error when both unbounded:true and maxIterations are provided', () => {
    expect(() => loop({ unbounded: true, maxIterations: 50, do: noop() })).toThrow(
      /cannot combine unbounded: true with an explicit maxIterations/
    );
    expect(() => loop({ unbounded: true, maxIterations: 50, do: noop() })).toThrow(/50/);
    expect(() => loop({ unbounded: true, maxIterations: 50, do: noop() })).toThrow(/choose one/);
  });

  it('does not throw for unbounded:true alone (no maxIterations)', () => {
    expect(() => loop({ unbounded: true, do: noop() })).not.toThrow();
  });

  it('does not throw for maxIterations alone (no unbounded)', () => {
    expect(() => loop({ maxIterations: 50, do: noop() })).not.toThrow();
  });
});
