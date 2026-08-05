import { describe, it, expect } from 'vitest';
import { encodeTypedArray, decodeTypedArray, isEncodableTypedArray } from './typed-array-codec.js';

/**
 * Direct tests for the typed-array codec.
 *
 * The base64 implementation is hand-rolled (see the module header for why), so it
 * is checked against Node's `Buffer` — an independent implementation — across
 * every payload length modulo 3, plus a large pseudo-random payload. A bug in a
 * hand-rolled base64 would otherwise surface as silent state corruption, which is
 * precisely the failure mode this codec exists to remove.
 */
describe('typed array codec', () => {
  it('produces exactly the same base64 as an independent implementation', () => {
    // Lengths 0..8 cover every remainder mod 3 (both padding cases and neither).
    for (let length = 0; length <= 8; length++) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 37 + 11) % 256;
      const encoded = encodeTypedArray(bytes, 'test').data;
      expect(encoded, `length ${length}`).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('matches the reference encoder on a large payload spanning all byte values', () => {
    const bytes = new Uint8Array(4099);
    // Deterministic LCG so the payload exercises every byte value without a
    // nondeterministic test.
    let seed = 12345;
    for (let i = 0; i < bytes.length; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      bytes[i] = seed % 256;
    }
    const encoded = encodeTypedArray(bytes, 'test').data;
    expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
    expect([...(decodeTypedArray({ __typedArray: 'Uint8Array', data: encoded }) as Uint8Array)]).toEqual([...bytes]);
  });

  it('does not overflow the call stack on an array too big for String.fromCharCode(...bytes)', () => {
    const bytes = new Uint8Array(300_000).fill(9);
    const encoded = encodeTypedArray(bytes, 'test');
    const decoded = decodeTypedArray(encoded) as Uint8Array;
    expect(decoded.length).toBe(300_000);
    expect(decoded[299_999]).toBe(9);
  });

  it('rejects a value that is not a supported typed array', () => {
    expect(() => encodeTypedArray(new DataView(new ArrayBuffer(4)), 'game.view')).toThrow(
      /DataView at property 'game.view'/
    );
  });

  it('rejects an unknown typed-array tag on decode', () => {
    expect(() => decodeTypedArray({ __typedArray: 'Float16Array', data: 'AAA=' })).toThrow(
      /unknown typed-array type/
    );
  });

  it('rejects a malformed base64 payload rather than decoding garbage', () => {
    expect(() => decodeTypedArray({ __typedArray: 'Uint8Array', data: 'AAA' })).toThrow(/not a multiple of 4/);
    expect(() => decodeTypedArray({ __typedArray: 'Uint8Array', data: 'A!A=' })).toThrow(/invalid character/);
    expect(() => decodeTypedArray({ __typedArray: 'Uint8Array', data: 42 as unknown as string })).toThrow(
      /expected a base64 string payload/
    );
  });

  it('rejects a payload that is not a whole number of elements', () => {
    // 3 bytes cannot form Int32Array elements.
    expect(() => decodeTypedArray({ __typedArray: 'Int32Array', data: 'AAAA' })).toThrow(
      /not a whole number of 4-byte elements/
    );
  });

  it('recognizes typed arrays but not DataView, ArrayBuffer or plain objects', () => {
    expect(isEncodableTypedArray(new Uint8Array(1))).toBe(true);
    expect(isEncodableTypedArray(new Float64Array(1))).toBe(true);
    expect(isEncodableTypedArray(new DataView(new ArrayBuffer(1)))).toBe(false);
    expect(isEncodableTypedArray(new ArrayBuffer(1))).toBe(false);
    expect(isEncodableTypedArray({ 0: 1 })).toBe(false);
    expect(isEncodableTypedArray([1, 2])).toBe(false);
  });
});
