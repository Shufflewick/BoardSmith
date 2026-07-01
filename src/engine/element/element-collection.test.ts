/**
 * FLOW-04 regression coverage for ElementCollection.shuffle()'s RNG
 * requirement: the `= Math.random` default was removed, making `random` a
 * required parameter (clean break, zero callers confirmed).
 */
import { describe, it, expect } from 'vitest';
import { ElementCollection } from './element-collection.js';

describe('ElementCollection.shuffle', () => {
  it('shuffles deterministically using a stub rng', () => {
    const collection = ElementCollection.from([1, 2, 3, 4, 5]) as ElementCollection<number>;

    // Deterministic stub sequence for Fisher-Yates: always pick index 0.
    let calls = 0;
    const stubRng = () => {
      calls++;
      return 0;
    };

    collection.shuffle(stubRng);

    // Fisher-Yates with random()=0 always swaps element i with element 0,
    // producing a fully reversed-ish deterministic order for this input.
    expect(collection).toEqual([2, 3, 4, 5, 1]);
    expect(calls).toBe(4);
  });

  it('rejects being invoked without an rng at runtime (no Math.random default)', () => {
    const collection = ElementCollection.from([1, 2, 3]) as ElementCollection<number>;
    // TypeScript rejects this at compile time (shuffle(random: () => number)
    // has no default). Simulate an untyped/JS caller bypassing the type
    // system to assert there is no silent Math.random fallback at runtime.
    const untypedShuffle = collection.shuffle as (random?: () => number) => ElementCollection<number>;
    expect(() => untypedShuffle.call(collection)).toThrow();
  });
});
