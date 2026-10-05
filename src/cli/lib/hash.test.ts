import { describe, expect, it } from 'vitest';
import { sha256Hex } from './hash.js';

describe('sha256Hex', () => {
  it('hashes text and bytes to the same lowercase hex digest', () => {
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(sha256Hex('abc')).toBe(expected);
    expect(sha256Hex(Buffer.from('abc'))).toBe(expected);
  });
});
