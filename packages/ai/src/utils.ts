/**
 * Create a seeded random number generator using mulberry32 algorithm.
 * Returns numbers in [0, 1) range.
 */
export function createSeededRandom(seed?: string): () => number {
  // Convert string seed to number using simple hash
  let h = 0;
  const seedStr = seed ?? Math.random().toString(36).substring(2);
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(31, h) + seedStr.charCodeAt(i) | 0;
  }

  // Mulberry32 PRNG
  return function () {
    h |= 0;
    h = h + 0x6D2B79F5 | 0;
    let t = Math.imul(h ^ h >>> 15, 1 | h);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Pick a random element from an array using the provided RNG
 */
export function randomChoice<T>(array: T[], rng: () => number): T {
  return array[Math.floor(rng() * array.length)];
}

/**
 * Shuffle an array in place using Fisher-Yates and the provided RNG
 */
export function shuffle<T>(array: T[], rng: () => number): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
