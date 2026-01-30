/**
 * @module utils/random
 *
 * Seeded random number generation for BoardSmith.
 * Provides deterministic randomness for reproducible game states and testing.
 *
 * Uses the mulberry32 algorithm for high-quality pseudo-random numbers.
 *
 * @example
 * ```typescript
 * import { SeededRandom } from 'boardsmith/utils';
 *
 * const rng = new SeededRandom('my-seed');
 * const value = rng.next();        // 0-1 float
 * const index = rng.nextInt(10);   // 0-9 integer
 * const item = rng.pick([1,2,3]);  // random element
 * const shuffled = rng.shuffle([1,2,3]); // new shuffled array
 * ```
 */

/**
 * Seeded random number generator using mulberry32 algorithm.
 *
 * Produces deterministic sequences given the same seed, which is essential
 * for reproducible game states, testing, and debugging.
 *
 * @example
 * ```typescript
 * // Create from string seed
 * const rng = new SeededRandom('game-123');
 *
 * // Basic usage
 * const roll = Math.floor(rng.next() * 6) + 1; // dice roll 1-6
 *
 * // Pick random element
 * const card = rng.pick(deck);
 *
 * // Shuffle a copy (original unchanged)
 * const shuffled = rng.shuffle(deck);
 *
 * // Get integer in range [0, max)
 * const index = rng.nextInt(array.length);
 * ```
 */
export class SeededRandom {
  private state: number;

  /**
   * Create a seeded random number generator.
   *
   * @param seed - String or number seed for reproducibility
   *
   * @example
   * ```typescript
   * const rng1 = new SeededRandom('my-seed');
   * const rng2 = new SeededRandom(12345);
   * ```
   */
  constructor(seed: string | number) {
    if (typeof seed === 'number') {
      this.state = seed >>> 0;
    } else {
      this.state = SeededRandom.hashString(seed);
    }
  }

  /**
   * Hash a string to a 32-bit unsigned integer.
   * Uses a simple but effective multiply-and-add hash.
   */
  private static hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
    }
    return hash >>> 0;
  }

  /**
   * Get the next random float in [0, 1).
   *
   * @returns Random number between 0 (inclusive) and 1 (exclusive)
   *
   * @example
   * ```typescript
   * const value = rng.next(); // e.g., 0.7234...
   * ```
   */
  next(): number {
    // Mulberry32 algorithm
    this.state = this.state + 0x6D2B79F5 | 0;
    let t = Math.imul(this.state ^ this.state >>> 15, 1 | this.state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  /**
   * Get a random integer in [0, max).
   *
   * @param max - Upper bound (exclusive)
   * @returns Integer from 0 to max-1
   *
   * @example
   * ```typescript
   * const index = rng.nextInt(array.length);
   * const diceRoll = rng.nextInt(6) + 1; // 1-6
   * ```
   */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  /**
   * Pick a random element from an array.
   *
   * @param array - Array to pick from
   * @returns Random element from the array
   * @throws If array is empty
   *
   * @example
   * ```typescript
   * const card = rng.pick(deck);
   * const winner = rng.pick(players);
   * ```
   */
  pick<T>(array: readonly T[]): T {
    if (array.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    return array[this.nextInt(array.length)];
  }

  /**
   * Return a new array with elements shuffled (original unchanged).
   * Uses Fisher-Yates shuffle algorithm.
   *
   * @param array - Array to shuffle
   * @returns New array with shuffled elements
   *
   * @example
   * ```typescript
   * const shuffled = rng.shuffle(deck);
   * // deck is unchanged, shuffled is a new array
   * ```
   */
  shuffle<T>(array: readonly T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Create a SeededRandom from a string seed.
   * Convenience factory method.
   *
   * @param seed - String seed
   * @returns New SeededRandom instance
   *
   * @example
   * ```typescript
   * const rng = SeededRandom.fromString('game-session-123');
   * ```
   */
  static fromString(seed: string): SeededRandom {
    return new SeededRandom(seed);
  }
}

/**
 * Create a seeded random number generator function.
 * Returns a function that produces numbers in [0, 1).
 *
 * This is a simpler alternative to SeededRandom when you only need
 * the basic next() functionality.
 *
 * @param seed - String seed for reproducibility
 * @returns Function that returns random floats [0, 1)
 *
 * @example
 * ```typescript
 * const rng = createSeededRandom('my-seed');
 * const value = rng(); // 0-1 float
 * const roll = Math.floor(rng() * 6) + 1; // dice roll
 * ```
 */
export function createSeededRandom(seed?: string): () => number {
  const instance = new SeededRandom(seed ?? Math.random().toString(36).substring(2));
  return () => instance.next();
}
