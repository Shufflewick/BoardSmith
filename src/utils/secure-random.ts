/**
 * Bytes from the platform's cryptographic random source, as lowercase hex.
 *
 * For secrets the engine mints itself: a game's random seed and its element id
 * key. There is no fallback: a value from a predictable source would let a
 * player recover what it protects.
 *
 * @param byteCount - how many random bytes
 * @param purpose - what they are for, completing "BoardSmith needs
 *   crypto.getRandomValues to ..."
 * @param otherwise - how a caller can supply the value instead, completing
 *   "... or a Workers runtime, or ..."
 */
export function secureRandomHex(byteCount: number, purpose: string, otherwise: string): string {
  // Read by its bare name, not as `globalThis.crypto`: Workers declares it
  // `const crypto`, which `typeof globalThis` does not carry (#488).
  const source = typeof crypto === 'undefined' ? undefined : crypto;
  if (typeof source?.getRandomValues !== 'function') {
    throw new Error(
      `BoardSmith needs crypto.getRandomValues to ${purpose}, and this runtime has none. ` +
        `Run the engine on Node 19 or later, a browser, or a Workers runtime, or ${otherwise}.`,
    );
  }
  const bytes = source.getRandomValues(new Uint8Array(byteCount));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
