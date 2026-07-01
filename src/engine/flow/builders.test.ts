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
