/**
 * The element id cipher (#447): Speck32/64 over the creation counter, keyed
 * from the game's seed.
 */
import { describe, it, expect } from 'vitest';
import {
  ELEMENT_ID_SPACE,
  opaqueElementIds,
  sequentialElementIds,
  speck32Encrypt,
  speck32RoundKeys,
} from './element-ids.js';

describe('Speck32/64', () => {
  it("matches the designers' test vector", () => {
    // Beaulieu et al., "The SIMON and SPECK Families of Lightweight Block
    // Ciphers" (2013), appendix C: key 1918 1110 0908 0100, plaintext
    // 6574 694c, ciphertext a868 42f2. A block cipher that reproduces it is a
    // permutation of its 32-bit block, which is what makes every id unique.
    const roundKeys = speck32RoundKeys([0x0100, 0x0908, 0x1110, 0x1918]);
    expect(speck32Encrypt(roundKeys, 0x6574694c)).toBe(0xa86842f2);
  });
});

describe('opaqueElementIds', () => {
  it('gives every counter value its own id', () => {
    const ids = opaqueElementIds('permutation');
    const seen = new Set<number>();
    for (let cursor = 0; cursor < 50_000; cursor += 1) seen.add(ids.mint(cursor));
    expect(seen.size).toBe(50_000);
  });

  it('keys on the whole seed', () => {
    const a = opaqueElementIds('seed-a').mint(0);
    expect(opaqueElementIds('seed-a').mint(0)).toBe(a);
    expect(opaqueElementIds('seed-b').mint(0)).not.toBe(a);
    expect(opaqueElementIds('seed-a ').mint(0)).not.toBe(a);
    // Seeds the RNG's 32-bit fold sends to the same state ("Aa" and "BB"
    // both hash to 2112) must still key differently.
    expect(opaqueElementIds('Aa').mint(0)).not.toBe(opaqueElementIds('BB').mint(0));
  });

  it('stays inside the id space and refuses a counter past it', () => {
    const ids = opaqueElementIds('edge');
    const last = ids.mint(ELEMENT_ID_SPACE - 1);
    expect(Number.isSafeInteger(last)).toBe(true);
    expect(last).toBeGreaterThanOrEqual(0);
    expect(last).toBeLessThan(ELEMENT_ID_SPACE);
    expect(() => ids.mint(ELEMENT_ID_SPACE)).toThrow(/every element id this game can mint/);
  });
});

describe('sequentialElementIds', () => {
  it('is the counter itself', () => {
    expect(sequentialElementIds.mint(0)).toBe(0);
    expect(sequentialElementIds.mint(1_000_123)).toBe(1_000_123);
  });
});
