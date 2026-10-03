import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { sha256 } from './sha256.js';

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const ascii = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'latin1'));

describe('sha256', () => {
  // FIPS 180-2, Appendix B.
  it('matches the published one-block vector ("abc")', () => {
    expect(hex(sha256(ascii('abc'))))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches the published two-block vector', () => {
    expect(hex(sha256(ascii('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('matches the digest of the empty message', () => {
    expect(hex(sha256(new Uint8Array(0))))
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  // Every length across the padding boundaries (55/56/64 bytes and their
  // multiples), checked against Node's own SHA-256.
  it('agrees with node:crypto for every length from 0 to 300 bytes', () => {
    for (let length = 0; length <= 300; length += 1) {
      const message = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) message[i] = (i * 131 + length * 7) & 0xff;
      expect(hex(sha256(message)), `length ${length}`)
        .toBe(createHash('sha256').update(message).digest('hex'));
    }
  });
});
