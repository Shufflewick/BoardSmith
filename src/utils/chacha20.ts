/**
 * The ChaCha20 block function (RFC 8439 section 2.3), in plain JavaScript.
 *
 * The seeded generator's keystream. It is pure 32-bit integer arithmetic, so it
 * gives the same words in Node, browsers and Workers. `chacha20.test.ts` holds
 * it to the RFC vector and to Node's implementation.
 */

// "expand 32-byte k", the four constant words every ChaCha20 block starts with.
const SIGMA0 = 0x61707865;
const SIGMA1 = 0x3320646e;
const SIGMA2 = 0x79622d32;
const SIGMA3 = 0x6b206574;

const rotl = (word: number, by: number): number => (word << by) | (word >>> (32 - by));

/**
 * Write one 64-byte ChaCha20 block, as 16 little-endian words, into `out`.
 *
 * The sixteen words live in local variables for the whole block: the
 * generator calls this once per eight draws, and a typed-array working copy
 * made each draw roughly seven times slower.
 *
 * @param key - the 256-bit key as 8 little-endian words
 * @param input - block words 12..15: RFC 8439 puts the block counter in word 12
 *   and the nonce in 13..15
 * @param out - 16 words, overwritten
 */
export function chacha20Block(key: Uint32Array, input: Uint32Array, out: Uint32Array): void {
  const k0 = key[0] | 0, k1 = key[1] | 0, k2 = key[2] | 0, k3 = key[3] | 0;
  const k4 = key[4] | 0, k5 = key[5] | 0, k6 = key[6] | 0, k7 = key[7] | 0;
  const n0 = input[0] | 0, n1 = input[1] | 0, n2 = input[2] | 0, n3 = input[3] | 0;

  let x0 = SIGMA0, x1 = SIGMA1, x2 = SIGMA2, x3 = SIGMA3;
  let x4 = k0, x5 = k1, x6 = k2, x7 = k3, x8 = k4, x9 = k5, x10 = k6, x11 = k7;
  let x12 = n0, x13 = n1, x14 = n2, x15 = n3;

  for (let round = 0; round < 10; round += 1) {
    // Column rounds.
    x0 = (x0 + x4) | 0; x12 = rotl(x12 ^ x0, 16); x8 = (x8 + x12) | 0; x4 = rotl(x4 ^ x8, 12);
    x0 = (x0 + x4) | 0; x12 = rotl(x12 ^ x0, 8); x8 = (x8 + x12) | 0; x4 = rotl(x4 ^ x8, 7);
    x1 = (x1 + x5) | 0; x13 = rotl(x13 ^ x1, 16); x9 = (x9 + x13) | 0; x5 = rotl(x5 ^ x9, 12);
    x1 = (x1 + x5) | 0; x13 = rotl(x13 ^ x1, 8); x9 = (x9 + x13) | 0; x5 = rotl(x5 ^ x9, 7);
    x2 = (x2 + x6) | 0; x14 = rotl(x14 ^ x2, 16); x10 = (x10 + x14) | 0; x6 = rotl(x6 ^ x10, 12);
    x2 = (x2 + x6) | 0; x14 = rotl(x14 ^ x2, 8); x10 = (x10 + x14) | 0; x6 = rotl(x6 ^ x10, 7);
    x3 = (x3 + x7) | 0; x15 = rotl(x15 ^ x3, 16); x11 = (x11 + x15) | 0; x7 = rotl(x7 ^ x11, 12);
    x3 = (x3 + x7) | 0; x15 = rotl(x15 ^ x3, 8); x11 = (x11 + x15) | 0; x7 = rotl(x7 ^ x11, 7);
    // Diagonal rounds.
    x0 = (x0 + x5) | 0; x15 = rotl(x15 ^ x0, 16); x10 = (x10 + x15) | 0; x5 = rotl(x5 ^ x10, 12);
    x0 = (x0 + x5) | 0; x15 = rotl(x15 ^ x0, 8); x10 = (x10 + x15) | 0; x5 = rotl(x5 ^ x10, 7);
    x1 = (x1 + x6) | 0; x12 = rotl(x12 ^ x1, 16); x11 = (x11 + x12) | 0; x6 = rotl(x6 ^ x11, 12);
    x1 = (x1 + x6) | 0; x12 = rotl(x12 ^ x1, 8); x11 = (x11 + x12) | 0; x6 = rotl(x6 ^ x11, 7);
    x2 = (x2 + x7) | 0; x13 = rotl(x13 ^ x2, 16); x8 = (x8 + x13) | 0; x7 = rotl(x7 ^ x8, 12);
    x2 = (x2 + x7) | 0; x13 = rotl(x13 ^ x2, 8); x8 = (x8 + x13) | 0; x7 = rotl(x7 ^ x8, 7);
    x3 = (x3 + x4) | 0; x14 = rotl(x14 ^ x3, 16); x9 = (x9 + x14) | 0; x4 = rotl(x4 ^ x9, 12);
    x3 = (x3 + x4) | 0; x14 = rotl(x14 ^ x3, 8); x9 = (x9 + x14) | 0; x4 = rotl(x4 ^ x9, 7);
  }

  out[0] = x0 + SIGMA0; out[1] = x1 + SIGMA1; out[2] = x2 + SIGMA2; out[3] = x3 + SIGMA3;
  out[4] = x4 + k0; out[5] = x5 + k1; out[6] = x6 + k2; out[7] = x7 + k3;
  out[8] = x8 + k4; out[9] = x9 + k5; out[10] = x10 + k6; out[11] = x11 + k7;
  out[12] = x12 + n0; out[13] = x13 + n1; out[14] = x14 + n2; out[15] = x15 + n3;
}
