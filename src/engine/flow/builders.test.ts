import { describe, it, expect } from 'vitest';
import { actionStep, loop, sequence, simultaneousActionStep, switchOn } from './builders.js';

describe('loop() — PIT-01 construction-time maxIterations guard', () => {
  it('throws an actionable error when maxIterations is omitted', () => {
    // @ts-expect-error -- no maxIterations and no unbounded: true; a compiled rule reaches the runtime check
    expect(() => loop({ do: sequence() })).toThrow(/maxIterations/);
    // @ts-expect-error -- no maxIterations and no unbounded: true; a compiled rule reaches the runtime check
    expect(() => loop({ do: sequence() })).toThrow(/loop\(\{ maxIterations: 100/);
    // @ts-expect-error -- no maxIterations and no unbounded: true; a compiled rule reaches the runtime check
    expect(() => loop({ do: sequence() })).toThrow(/10000/);
  });

  it('constructs a valid loop FlowNode when maxIterations is provided', () => {
    const node = loop({ maxIterations: 10, do: sequence() });
    expect(node.type).toBe('loop');
    expect((node.config as { maxIterations?: number }).maxIterations).toBe(10);
  });

  it('preserves while and name alongside maxIterations', () => {
    const whileFn = () => false;
    const node = loop({ name: 'my-loop', maxIterations: 5, while: whileFn, do: sequence() });
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
    expect(() => loop({ unbounded: true, do: sequence() })).not.toThrow();

    const node = loop({ unbounded: true, do: sequence() });
    expect(node.type).toBe('loop');
    expect((node.config as { unbounded?: boolean }).unbounded).toBe(true);
    expect((node.config as { maxIterations?: number }).maxIterations).toBeUndefined();
  });

  // Test B (no-regression, RESEARCH Pitfall 2): omitting BOTH maxIterations and
  // unbounded must still throw, and the message must name the unbounded valve
  // too (not just maxIterations) so authors discover the correct fix.
  it('still throws, naming both the bounded and unbounded valves, when neither is provided', () => {
    // @ts-expect-error -- no maxIterations and no unbounded: true; a compiled rule reaches the runtime check
    expect(() => loop({ do: sequence() })).toThrow(/maxIterations/);
    // @ts-expect-error -- no maxIterations and no unbounded: true; a compiled rule reaches the runtime check
    expect(() => loop({ do: sequence() })).toThrow(/unbounded/);
  });
});

describe('loop() — 164-IN-02 conflicting unbounded + maxIterations guard', () => {
  // Pre-fix: unbounded:true + an explicit maxIterations silently resolves to
  // the bounded behavior (maxIterations wins), with unbounded becoming a
  // no-op nothing tells the author about -- a plausible authoring mistake
  // (e.g. leftover maxIterations from before adding unbounded:true).
  it('throws an actionable error when both unbounded:true and maxIterations are provided', () => {
    // @ts-expect-error -- maxIterations and unbounded: true together; a compiled rule reaches the runtime check
    expect(() => loop({ unbounded: true, maxIterations: 50, do: sequence() })).toThrow(
      /cannot combine unbounded: true with an explicit maxIterations/
    );
    // @ts-expect-error -- maxIterations and unbounded: true together; a compiled rule reaches the runtime check
    expect(() => loop({ unbounded: true, maxIterations: 50, do: sequence() })).toThrow(/50/);
    // @ts-expect-error -- maxIterations and unbounded: true together; a compiled rule reaches the runtime check
    expect(() => loop({ unbounded: true, maxIterations: 50, do: sequence() })).toThrow(/choose one/);
  });
});

describe('switchOn() refuses a case named "__default" (#1176)', () => {
  it('names the case and tells the author to rename it', () => {
    expect(() => switchOn({ name: 'phase', on: () => 'x', cases: { __default: sequence() } })).toThrow(
      /switchOn "phase" has a case named "__default".*Rename the case/,
    );
  });

  it('accepts ordinary case names and a default branch', () => {
    expect(() => switchOn({ on: () => 'x', cases: { draw: sequence(), 1: sequence() }, default: sequence() })).not.toThrow();
  });
});

describe('a step that still sets timeLimitMs is refused, not built untimed (#1835)', () => {
  it('names the action step and points to timed: true and defaultTimePerTurn', () => {
    // @ts-expect-error -- timeLimitMs is gone; a plain JavaScript game reaches the runtime check
    expect(() => actionStep({ name: 'bid', actions: ['bid'], timeLimitMs: 30000 })).toThrow(
      /actionStep "bid" sets timeLimitMs.*timed: true.*defaultTimePerTurn/s,
    );
  });

  it('names the simultaneous step', () => {
    // @ts-expect-error -- timeLimitMs is gone; a plain JavaScript game reaches the runtime check
    expect(() => simultaneousActionStep({ name: 'draft', actions: ['pick'], timeLimitMs: 30000 })).toThrow(
      /simultaneousActionStep "draft" sets timeLimitMs/,
    );
  });
});
