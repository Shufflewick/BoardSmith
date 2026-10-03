/**
 * The ChaCha20 block function (RFC 8439 section 2.3), in plain JavaScript.
 *
 * The seeded generator's keystream. It is pure 32-bit integer arithmetic, so it
 * gives the same words in Node, browsers and Workers. `chacha20.test.ts` holds
 * it to the RFC vector and to Node's implementation.
 */

// "expand 32-byte k", the four constant words every ChaCha20 block starts with.
const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];

const working = new Uint32Array(16);

function quarterRound(x: Uint32Array, a: number, b: number, c: number, d: number): void {
  x[a] += x[b]; x[d] ^= x[a]; x[d] = (x[d] << 16) | (x[d] >>> 16);
  x[c] += x[d]; x[b] ^= x[c]; x[b] = (x[b] << 12) | (x[b] >>> 20);
  x[a] += x[b]; x[d] ^= x[a]; x[d] = (x[d] << 8) | (x[d] >>> 24);
  x[c] += x[d]; x[b] ^= x[c]; x[b] = (x[b] << 7) | (x[b] >>> 25);
}

/**
 * Write one 64-byte ChaCha20 block, as 16 little-endian words, into `out`.
 *
 * @param key - the 256-bit key as 8 little-endian words
 * @param input - block words 12..15: RFC 8439 puts the block counter in word 12
 *   and the nonce in 13..15
 * @param out - 16 words, overwritten
 */
export function chacha20Block(key: Uint32Array, input: Uint32Array, out: Uint32Array): void {
  out[0] = SIGMA[0];
  out[1] = SIGMA[1];
  out[2] = SIGMA[2];
  out[3] = SIGMA[3];
  out.set(key.subarray(0, 8), 4);
  out.set(input.subarray(0, 4), 12);
  working.set(out);
  for (let round = 0; round < 10; round += 1) {
    quarterRound(working, 0, 4, 8, 12);
    quarterRound(working, 1, 5, 9, 13);
    quarterRound(working, 2, 6, 10, 14);
    quarterRound(working, 3, 7, 11, 15);
    quarterRound(working, 0, 5, 10, 15);
    quarterRound(working, 1, 6, 11, 12);
    quarterRound(working, 2, 7, 8, 13);
    quarterRound(working, 3, 4, 9, 14);
  }
  for (let i = 0; i < 16; i += 1) out[i] += working[i];
}
