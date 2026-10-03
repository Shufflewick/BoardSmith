/**
 * @module utils/random
 *
 * Seeded random number generation for BoardSmith.
 * Provides deterministic randomness for reproducible game states and testing.
 *
 * The generator is ChaCha20 keyed by SHA-256 of the whole seed (#483). Its
 * state is that 256-bit key and a position in the keystream, so a seed's
 * draws cannot be recovered by searching a small state space, and two seeds
 * give the same game only if their SHA-256 collides.
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

import { chacha20Block } from './chacha20.js';
import { sha256 } from './sha256.js';

/**
 * A seeded generator's whole state, as `getState` writes it:
 * `chacha20:<key as 64 hex digits>:<keystream position in words, hex>`.
 * Opaque to callers: store it, compare it with `===`, hand it to `setState`.
 * Two states `getState` wrote are equal exactly when the generators will draw
 * the same sequence, and every draw changes it.
 */
export type RandomState = string;

const STATE_PATTERN = /^chacha20:([0-9a-f]{64}):([0-9a-f]{1,14})$/;

/** Positions are counted in 32-bit words and must stay exact as a JS number. */
const POSITION_LIMIT = Number.MAX_SAFE_INTEGER;

/** The seed's UTF-16 code units, two bytes each, big-endian: injective for every string. */
function seedBytes(seed: string): Uint8Array {
  const bytes = new Uint8Array(seed.length * 2);
  for (let i = 0; i < seed.length; i += 1) {
    const unit = seed.charCodeAt(i);
    bytes[i * 2] = unit >>> 8;
    bytes[i * 2 + 1] = unit & 0xff;
  }
  return bytes;
}

/** ChaCha20 reads its key as little-endian words. */
function keyWords(keyBytes: Uint8Array): Uint32Array {
  const view = new DataView(keyBytes.buffer, keyBytes.byteOffset, 32);
  return Uint32Array.from({ length: 8 }, (_, i) => view.getUint32(i * 4, true));
}

function keyHex(key: Uint32Array): string {
  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer);
  key.forEach((word, i) => view.setUint32(i * 4, word, true));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function describeRefusedState(state: unknown): string {
  if (typeof state === 'number') {
    return (
      'Cannot restore random state: it is a number, which is the generator BoardSmith used before ' +
      '#483. A game saved before that change cannot be continued on this engine; start a new game.'
    );
  }
  return (
    'Cannot restore random state: it is not one this engine wrote (expected ' +
    '"chacha20:<64 hex digits>:<position>", got ' +
    (typeof state === 'string' ? `a ${state.length}-character string` : `a ${typeof state}`) +
    '). Restore only a state taken from getState() or getRandomState().'
  );
}

/**
 * Seeded random number generator: ChaCha20 keyed by SHA-256 of the seed.
 *
 * Produces deterministic sequences given the same seed, which is essential
 * for reproducible game states, testing, and debugging. The output is the same
 * in Node, browsers and Workers, and `getState`/`setState` capture and restore
 * the exact position.
 *
 * The key is SHA-256 of the seed's UTF-16 code units (two bytes each,
 * big-endian). The stream is ChaCha20's keystream from block 0, with the
 * block number in words 12 (low 32 bits) and 13 (high bits) and words 14 and
 * 15 zero. Each draw takes the next two words and makes a 53-bit fraction from
 * the first word's high 27 bits and the second word's high 26.
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
  #key: Uint32Array;
  #keyHex: string;
  /** Keystream words consumed so far. */
  #position = 0;
  /** The block `#buffer` holds, or -1 when it must be computed. */
  #bufferedBlock = -1;
  readonly #buffer = new Uint32Array(16);
  readonly #input = new Uint32Array(4);

  /**
   * Create a seeded random number generator.
   *
   * @param seed - Any string; every character of it shapes the sequence
   *
   * @example
   * ```typescript
   * const rng = new SeededRandom('my-seed');
   * ```
   */
  constructor(seed: string) {
    this.#key = keyWords(sha256(seedBytes(seed)));
    this.#keyHex = keyHex(this.#key);
  }

  #nextWord(): number {
    const position = this.#position;
    if (position >= POSITION_LIMIT) {
      throw new Error('This random generator has drawn its whole stream (2^53 words); start a new seed.');
    }
    const block = Math.floor(position / 16);
    if (block !== this.#bufferedBlock) {
      this.#input[0] = block % 2 ** 32;
      this.#input[1] = Math.floor(block / 2 ** 32);
      chacha20Block(this.#key, this.#input, this.#buffer);
      this.#bufferedBlock = block;
    }
    this.#position = position + 1;
    return this.#buffer[position % 16];
  }

  /**
   * Get the next random float in [0, 1), with 53 bits of resolution.
   *
   * @returns Random number between 0 (inclusive) and 1 (exclusive)
   *
   * @example
   * ```typescript
   * const value = rng.next(); // e.g., 0.7234...
   * ```
   */
  next(): number {
    const high = this.#nextWord() >>> 5;
    const low = this.#nextWord() >>> 6;
    return (high * 67108864 + low) / 9007199254740992;
  }

  /**
   * The generator's whole state. Handing it to `setState` on any
   * `SeededRandom` makes that generator draw exactly what this one will next.
   */
  getState(): RandomState {
    return `chacha20:${this.#keyHex}:${this.#position.toString(16)}`;
  }

  /**
   * Restore a state taken from `getState`. A state this engine did not write,
   * including a numeric one saved before #483, is refused and the generator
   * is left as it was.
   */
  setState(state: RandomState): void {
    const match = typeof state === 'string' ? STATE_PATTERN.exec(state) : null;
    const position = match === null ? NaN : parseInt(match[2], 16);
    if (match === null || !(position < POSITION_LIMIT)) {
      throw new Error(describeRefusedState(state));
    }
    const keyBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) keyBytes[i] = parseInt(match[1].slice(i * 2, i * 2 + 2), 16);
    this.#key = keyWords(keyBytes);
    this.#keyHex = match[1];
    this.#position = position;
    this.#bufferedBlock = -1;
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
 * The seed is required: this generator exists for deterministic, reproducible
 * randomness (replay, testing, bot cloning). Callers that want a fresh sequence
 * must generate and pass their own seed explicitly so it can be recorded.
 *
 * @param seed - String seed for reproducibility (required)
 * @returns Function that returns random floats [0, 1)
 *
 * @example
 * ```typescript
 * const rng = createSeededRandom('my-seed');
 * const value = rng(); // 0-1 float
 * const roll = Math.floor(rng() * 6) + 1; // dice roll
 * ```
 */
export function createSeededRandom(seed: string): () => number {
  const instance = new SeededRandom(seed);
  return () => instance.next();
}
