import { createCipheriv, createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { SeededRandom, createSeededRandom } from './random.js';

const draws = (rng: SeededRandom, count: number): number[] => Array.from({ length: count }, () => rng.next());

/**
 * The generator as its documentation states it, built from Node's own SHA-256
 * and ChaCha20 rather than from this module: the key is SHA-256 of the seed's
 * UTF-16 code units (two bytes each, big-endian), the stream is ChaCha20's
 * keystream from block 0 with words 13..15 zero, and each draw takes two
 * words, high 27 bits then low 26.
 */
function referenceDraws(seed: string, count: number): number[] {
  const encoded = Buffer.alloc(seed.length * 2);
  for (let i = 0; i < seed.length; i += 1) encoded.writeUInt16BE(seed.charCodeAt(i), i * 2);
  const key = createHash('sha256').update(encoded).digest();
  const stream = createCipheriv('chacha20', key, Buffer.alloc(16)).update(Buffer.alloc(count * 8));
  return Array.from({ length: count }, (_, i) => {
    const high = stream.readUInt32LE(i * 8) >>> 5;
    const low = stream.readUInt32LE(i * 8 + 4) >>> 6;
    return (high * 2 ** 26 + low) / 2 ** 53;
  });
}

describe('SeededRandom generator (#483)', () => {
  it('is ChaCha20 keyed by SHA-256 of the whole seed, across several blocks', () => {
    for (const seed of ['', 'abc', 'game-123', '0f1e2d3c4b5a69788796a5b4c3d2e1f0', 'caf\u00e9 \u{1F3B2}']) {
      expect(draws(new SeededRandom(seed), 40), seed).toEqual(referenceDraws(seed, 40));
    }
  });

  // Under the old generator every seed folded to one 32-bit number
  // (h = 31*h + charCode), so these pairs were the same game.
  it('tells apart seeds that the old 32-bit fold made identical', () => {
    expect(draws(new SeededRandom('Aa'), 10)).not.toEqual(draws(new SeededRandom('BB'), 10));
    const prefix = '9c41d7e05b2a8f3e6d1c0b9a8f7e6d';
    expect(draws(new SeededRandom(`${prefix}Aa`), 10)).not.toEqual(draws(new SeededRandom(`${prefix}BB`), 10));
  });

  it('tells apart 128-bit seeds that differ only in their last character', () => {
    const a = new SeededRandom('0f1e2d3c4b5a69788796a5b4c3d2e1f0');
    const b = new SeededRandom('0f1e2d3c4b5a69788796a5b4c3d2e1f1');
    expect(draws(a, 10)).not.toEqual(draws(b, 10));
  });

  it('gives each draw 53 bits, so a draw can land between two 32-bit steps', () => {
    const values = draws(new SeededRandom('resolution'), 200);
    expect(values.some((value) => !Number.isInteger(value * 2 ** 32))).toBe(true);
  });
});

describe('SeededRandom state (#483)', () => {
  it('carries the whole 256-bit key and the position in its state', () => {
    const state = new SeededRandom('state-shape').getState();
    expect(state).toMatch(/^chacha20:[0-9a-f]{64}:0$/);
  });

  it('restoring mid-sequence continues exactly where the generator left off', () => {
    const live = new SeededRandom('restore-me');
    draws(live, 13);
    const saved = JSON.parse(JSON.stringify(live.getState())) as string;
    const expected = draws(live, 30);

    const restored = new SeededRandom('some other seed entirely');
    restored.setState(saved);
    expect(draws(restored, 30)).toEqual(expected);
    expect(restored.getState()).toBe(live.getState());
  });

  it('restores at every position inside and across block boundaries', () => {
    const reference = draws(new SeededRandom('boundaries'), 40);
    const live = new SeededRandom('boundaries');
    for (let i = 0; i < 39; i += 1) {
      const restored = new SeededRandom('x');
      restored.setState(live.getState());
      expect(restored.next(), `after ${i} draws`).toBe(reference[i]);
      live.next();
    }
  });

  it('state changes with every draw, so equal states mean no draw happened', () => {
    const rng = new SeededRandom('fence');
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      seen.add(rng.getState());
      rng.next();
    }
    expect(seen.size).toBe(50);
  });

  it('refuses a pre-#483 numeric state, saying the save cannot be continued', () => {
    const rng = new SeededRandom('old');
    expect(() => rng.setState(123456 as unknown as string)).toThrow(/number.*before.*#483.*cannot be continued/s);
  });

  it.each([
    ['empty', ''],
    ['wrong algorithm', `mulberry32:${'0'.repeat(64)}:0`],
    ['short key', `chacha20:${'0'.repeat(63)}:0`],
    ['upper-case key', `chacha20:${'A'.repeat(64)}:0`],
    ['negative position', `chacha20:${'0'.repeat(64)}:-1`],
    ['position past 2^53', `chacha20:${'0'.repeat(64)}:20000000000000`],
  ])('refuses a malformed state (%s) and leaves the generator as it was', (_label, state) => {
    const rng = new SeededRandom('keep');
    const before = rng.getState();
    expect(() => rng.setState(state)).toThrow(/random state/i);
    expect(rng.getState()).toBe(before);
  });
});

describe('SeededRandom', () => {
  describe('determinism', () => {
    it('produces the identical sequence for the same string seed', () => {
      const a = new SeededRandom('game-123');
      const b = new SeededRandom('game-123');
      const seqA = Array.from({ length: 50 }, () => a.next());
      const seqB = Array.from({ length: 50 }, () => b.next());
      expect(seqA).toEqual(seqB);
    });

    it('diverges for different seeds', () => {
      const a = new SeededRandom('seed-a');
      const b = new SeededRandom('seed-b');
      expect(Array.from({ length: 20 }, () => a.next()))
        .not.toEqual(Array.from({ length: 20 }, () => b.next()));
    });

    it('fromString is equivalent to the string constructor', () => {
      const a = SeededRandom.fromString('table-7');
      const b = new SeededRandom('table-7');
      expect(Array.from({ length: 10 }, () => a.next()))
        .toEqual(Array.from({ length: 10 }, () => b.next()));
    });

    it('treats the empty string as a valid seed', () => {
      const a = new SeededRandom('');
      const b = new SeededRandom('');
      expect(a.next()).toBe(b.next());
    });
  });

  describe('next', () => {
    it('stays within [0, 1)', () => {
      const rng = new SeededRandom('range-check');
      for (let i = 0; i < 2000; i++) {
        const value = rng.next();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });

    it('does not repeat itself over a short run', () => {
      const rng = new SeededRandom('unique-check');
      const values = Array.from({ length: 500 }, () => rng.next());
      expect(new Set(values).size).toBe(500);
    });

    it('spreads roughly evenly across the unit interval', () => {
      const rng = new SeededRandom('distribution');
      const buckets = new Array(10).fill(0);
      const samples = 20000;
      for (let i = 0; i < samples; i++) {
        buckets[Math.floor(rng.next() * 10)]++;
      }
      for (const count of buckets) {
        // Each bucket should hold ~10%; allow a generous ±3% band.
        expect(count / samples).toBeGreaterThan(0.07);
        expect(count / samples).toBeLessThan(0.13);
      }
    });
  });

  describe('nextInt', () => {
    it('returns integers in [0, max)', () => {
      const rng = new SeededRandom('int-range');
      for (let i = 0; i < 1000; i++) {
        const value = rng.nextInt(6);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(6);
      }
    });

    it('eventually hits every value in the range', () => {
      const rng = new SeededRandom('coverage');
      const seen = new Set<number>();
      for (let i = 0; i < 500; i++) seen.add(rng.nextInt(6));
      expect(seen.size).toBe(6);
    });

    it('nextInt(1) is always 0', () => {
      const rng = new SeededRandom('single');
      for (let i = 0; i < 20; i++) expect(rng.nextInt(1)).toBe(0);
    });
  });

  describe('pick', () => {
    it('returns an element of the array', () => {
      const rng = new SeededRandom('pick');
      const deck = ['A', 'B', 'C', 'D'];
      for (let i = 0; i < 100; i++) {
        expect(deck).toContain(rng.pick(deck));
      }
    });

    it('can reach every element', () => {
      const rng = new SeededRandom('pick-coverage');
      const deck = ['A', 'B', 'C', 'D'];
      const seen = new Set(Array.from({ length: 200 }, () => rng.pick(deck)));
      expect(seen.size).toBe(4);
    });

    it('always returns the only element of a one-item array', () => {
      const rng = new SeededRandom('one');
      expect(rng.pick(['only'])).toBe('only');
    });

    it('throws an actionable error on an empty array', () => {
      const rng = new SeededRandom('empty');
      expect(() => rng.pick([])).toThrow('Cannot pick from empty array');
    });

    it('picks the same elements from the same seed', () => {
      const deck = [1, 2, 3, 4, 5, 6, 7, 8];
      const a = new SeededRandom('same');
      const b = new SeededRandom('same');
      expect(Array.from({ length: 10 }, () => a.pick(deck)))
        .toEqual(Array.from({ length: 10 }, () => b.pick(deck)));
    });
  });

  describe('shuffle', () => {
    it('leaves the source array untouched', () => {
      const rng = new SeededRandom('shuffle');
      const deck = [1, 2, 3, 4, 5];
      const original = [...deck];
      rng.shuffle(deck);
      expect(deck).toEqual(original);
    });

    it('returns a new array, not the same reference', () => {
      const rng = new SeededRandom('shuffle-ref');
      const deck = [1, 2, 3];
      expect(rng.shuffle(deck)).not.toBe(deck);
    });

    it('is a permutation — same elements, same length', () => {
      const rng = new SeededRandom('permutation');
      const deck = Array.from({ length: 52 }, (_, i) => i);
      const shuffled = rng.shuffle(deck);
      expect(shuffled).toHaveLength(52);
      expect([...shuffled].sort((x, y) => x - y)).toEqual(deck);
    });

    it('actually reorders a reasonably sized deck', () => {
      const rng = new SeededRandom('reorder');
      const deck = Array.from({ length: 52 }, (_, i) => i);
      expect(rng.shuffle(deck)).not.toEqual(deck);
    });

    it('produces the same order for the same seed', () => {
      const deck = Array.from({ length: 20 }, (_, i) => i);
      expect(new SeededRandom('deal-1').shuffle(deck))
        .toEqual(new SeededRandom('deal-1').shuffle(deck));
    });

    it('handles empty and single-element arrays', () => {
      const rng = new SeededRandom('edge');
      expect(rng.shuffle([])).toEqual([]);
      expect(rng.shuffle(['x'])).toEqual(['x']);
    });

    it('reaches every permutation of a 3-element array', () => {
      const rng = new SeededRandom('all-perms');
      const seen = new Set<string>();
      for (let i = 0; i < 500; i++) seen.add(rng.shuffle(['a', 'b', 'c']).join(''));
      expect(seen.size).toBe(6);
    });
  });

  describe('shared state', () => {
    it('each call advances the generator rather than repeating', () => {
      const rng = new SeededRandom('advance');
      const first = rng.next();
      const second = rng.next();
      expect(first).not.toBe(second);
    });

    it('nextInt, pick and shuffle all draw from the same stream', () => {
      const drawViaHelpers = () => {
        const rng = new SeededRandom('stream');
        rng.nextInt(10);
        rng.pick([1, 2, 3]);
        rng.shuffle([1, 2, 3, 4]);
        return rng.next();
      };
      const drawRaw = () => {
        const rng = new SeededRandom('stream');
        // 1 draw for nextInt, 1 for pick, 3 for a 4-element Fisher-Yates shuffle.
        for (let i = 0; i < 5; i++) rng.next();
        return rng.next();
      };
      expect(drawViaHelpers()).toBe(drawRaw());
    });
  });
});

describe('createSeededRandom', () => {
  it('returns a function producing values in [0, 1)', () => {
    const rng = createSeededRandom('fn-seed');
    for (let i = 0; i < 500; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('matches SeededRandom for the same seed', () => {
    const fn = createSeededRandom('parity');
    const cls = new SeededRandom('parity');
    expect(Array.from({ length: 20 }, () => fn()))
      .toEqual(Array.from({ length: 20 }, () => cls.next()));
  });

  it('two generators from the same seed replay identically', () => {
    const a = createSeededRandom('replay');
    const b = createSeededRandom('replay');
    expect(Array.from({ length: 20 }, () => a()))
      .toEqual(Array.from({ length: 20 }, () => b()));
  });

  it('each returned function owns its own independent state', () => {
    const a = createSeededRandom('independent');
    const b = createSeededRandom('independent');
    a();
    a();
    // b is untouched, so it still starts at the head of the sequence.
    expect(b()).toBe(createSeededRandom('independent')());
  });
});
