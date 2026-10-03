/**
 * The element id ciphers: Speck32/64 over a table game's creation counter,
 * keyed by a 64-bit secret minted per game (#447), and Speck48/96 over a
 * world's, keyed by a 96-bit secret its host keeps (#482).
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  ELEMENT_ID_SPACE,
  SPECK_32_64,
  SPECK_48_96,
  WORLD_ELEMENT_ID_SPACE,
  mintElementIdKey,
  mintWorldElementIdKey,
  opaqueElementIds,
  speck,
  worldElementIds,
} from './element-ids.js';

describe('Speck', () => {
  it("matches the designers' Speck32/64 test vector", () => {
    // Beaulieu et al., "The SIMON and SPECK Families of Lightweight Block
    // Ciphers" (2013), appendix C: key 1918 1110 0908 0100, plaintext
    // 6574 694c, ciphertext a868 42f2. A block cipher that reproduces it is a
    // permutation of its 32-bit block, which is what makes every id unique.
    const cipher = speck(SPECK_32_64, [0x0100, 0x0908, 0x1110, 0x1918]);
    expect(cipher.encrypt(0x6574694c)).toBe(0xa86842f2);
  });

  it("matches the designers' Speck48/96 test vector", () => {
    // The same appendix: key 1a1918 121110 0a0908 020100, plaintext
    // 6d2073 696874, ciphertext 735e10 b6445d.
    const cipher = speck(SPECK_48_96, [0x020100, 0x0a0908, 0x121110, 0x1a1918]);
    expect(cipher.encrypt(0x6d2073696874)).toBe(0x735e10b6445d);
  });

  it('decrypts what it encrypts, at the edges of the block too', () => {
    const cipher = speck(SPECK_48_96, [0x020100, 0x0a0908, 0x121110, 0x1a1918]);
    for (const block of [0, 1, 2 ** 24, 2 ** 24 - 1, 0x6d2073696874, WORLD_ELEMENT_ID_SPACE - 1]) {
      expect(cipher.decrypt(cipher.encrypt(block))).toBe(block);
    }
    expect(cipher.decrypt(0x735e10b6445d)).toBe(0x6d2073696874);
  });

  it('reads an id key as the four key words, high word first', () => {
    expect(opaqueElementIds('1918111009080100').mint(0x6574694c)).toBe(0xa86842f2);
    expect(worldElementIds('1a19181211100a0908020100').mint(0x6d2073696874)).toBe(0x735e10b6445d);
  });
});

describe('mintElementIdKey', () => {
  it('mints 64 random bits as 16 hex digits, a new one each time', () => {
    const keys = new Set(Array.from({ length: 64 }, () => mintElementIdKey()));
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(keys.size).toBe(64);
  });

  describe('with no secure random source', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('refuses when the runtime has no crypto global at all', () => {
      vi.stubGlobal('crypto', undefined);
      expect(() => mintElementIdKey()).toThrow(/needs crypto\.getRandomValues/);
      expect(() => mintWorldElementIdKey()).toThrow(/needs crypto\.getRandomValues/);
    });

    it('refuses when crypto has no getRandomValues', () => {
      vi.stubGlobal('crypto', {});
      expect(() => mintElementIdKey()).toThrow(/needs crypto\.getRandomValues/);
      expect(() => mintWorldElementIdKey()).toThrow(/needs crypto\.getRandomValues/);
    });
  });
});

describe('mintWorldElementIdKey', () => {
  it('mints 96 random bits as 24 hex digits, a new one each time', () => {
    const keys = new Set(Array.from({ length: 64 }, () => mintWorldElementIdKey()));
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{24}$/);
    expect(keys.size).toBe(64);
  });
});

describe('opaqueElementIds', () => {
  it('gives every counter value its own id', () => {
    const ids = opaqueElementIds('0123456789abcdef');
    const seen = new Set<number>();
    for (let cursor = 0; cursor < 50_000; cursor += 1) seen.add(ids.mint(cursor));
    expect(seen.size).toBe(50_000);
  });

  it('refuses a key that is not 16 hex digits', () => {
    expect(() => opaqueElementIds('abc')).toThrow(/16 hexadecimal digits/);
    expect(() => opaqueElementIds('0123456789ABCDEF')).toThrow(/16 hexadecimal digits/);
  });

  it('stays inside the id space and refuses a counter past it', () => {
    const ids = opaqueElementIds('fedcba9876543210');
    const last = ids.mint(ELEMENT_ID_SPACE - 1);
    expect(Number.isSafeInteger(last)).toBe(true);
    expect(last).toBeGreaterThanOrEqual(0);
    expect(last).toBeLessThan(ELEMENT_ID_SPACE);
    expect(() => ids.mint(ELEMENT_ID_SPACE)).toThrow(/every element id this game can mint/);
  });
});

describe('worldElementIds', () => {
  const KEY = '00112233445566778899aabb';

  it('gives every counter value its own id, and reads each id back to its counter', () => {
    const ids = worldElementIds(KEY);
    const seen = new Set<number>();
    // The construction range and the stored range a real world mints from,
    // both: one permutation over one counter is what keeps them apart.
    for (const start of [0, 1_000_000]) {
      for (let cursor = start; cursor < start + 25_000; cursor += 1) {
        const id = ids.mint(cursor);
        expect(ids.cursorOf(id)).toBe(cursor);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(50_000);
  });

  it('carries no count: consecutive counter values are not consecutive ids', () => {
    const ids = worldElementIds(KEY);
    const minted = Array.from({ length: 64 }, (_unused, index) => ids.mint(1_000_000 + index));
    const ascending = minted.every((id, index) => index === 0 || id > minted[index - 1]!);
    expect(ascending).toBe(false);
    expect(minted).not.toContain(1_000_000);
  });

  it('mints different ids under a different key', () => {
    const one = worldElementIds(KEY);
    const other = worldElementIds('bbaa99887766554433221100');
    const differ = Array.from({ length: 32 }, (_unused, index) => 1_000_000 + index).filter(
      (cursor) => one.mint(cursor) !== other.mint(cursor),
    );
    expect(differ.length).toBe(32);
  });

  it('refuses a key that is not 24 hex digits, and says where one comes from', () => {
    expect(() => worldElementIds('0123456789abcdef')).toThrow(/24 hexadecimal digits/);
    expect(() => worldElementIds('00112233445566778899AABB')).toThrow(/24 hexadecimal digits/);
    expect(() => worldElementIds('00112233445566778899aabb')).not.toThrow();
    expect(() => worldElementIds('0123456789abcdef')).toThrow(/mintWorldElementIdKey/);
  });

  it('stays inside the 48-bit id space and refuses a counter past it', () => {
    const ids = worldElementIds(KEY);
    const last = ids.mint(WORLD_ELEMENT_ID_SPACE - 1);
    expect(Number.isSafeInteger(last)).toBe(true);
    expect(last).toBeGreaterThanOrEqual(0);
    expect(last).toBeLessThan(WORLD_ELEMENT_ID_SPACE);
    expect(() => ids.mint(WORLD_ELEMENT_ID_SPACE)).toThrow(/every element id this world can mint/);
  });

  it('refuses to read back a number no world id can be', () => {
    const ids = worldElementIds(KEY);
    expect(() => ids.cursorOf(-1)).toThrow(/not an element id/);
    expect(() => ids.cursorOf(1.5)).toThrow(/not an element id/);
    expect(() => ids.cursorOf(WORLD_ELEMENT_ID_SPACE)).toThrow(/not an element id/);
  });
});
