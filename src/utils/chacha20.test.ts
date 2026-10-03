import { createCipheriv } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { chacha20Block } from './chacha20.js';

/** Little-endian 32-bit words from bytes, the way ChaCha20 reads its inputs. */
function words(bytes: Uint8Array): Uint32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint32Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(i * 4, true));
}

/** The block's 64 bytes, serialised little-endian as RFC 8439 prints them. */
function blockHex(out: Uint32Array): string {
  const bytes = Buffer.alloc(64);
  out.forEach((word, i) => bytes.writeUInt32LE(word, i * 4));
  return bytes.toString('hex');
}

/** Node's ChaCha20 (OpenSSL): its 16-byte IV is words 12..15 of the block input. */
function nodeBlock(key: Uint8Array, input: Uint8Array): string {
  return createCipheriv('chacha20', key, input).update(Buffer.alloc(64)).toString('hex');
}

describe('chacha20Block', () => {
  // RFC 8439 section 2.3.2.
  it('matches the RFC 8439 block function test vector', () => {
    const key = Uint8Array.from({ length: 32 }, (_, i) => i);
    const input = Buffer.from('01000000000000090000004a00000000', 'hex');
    const out = new Uint32Array(16);
    chacha20Block(words(key), words(input), out);
    expect(blockHex(out)).toBe(
      '10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4e' +
      'd2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e',
    );
  });

  it('agrees with node:crypto across keys and counter words, high bits included', () => {
    const out = new Uint32Array(16);
    for (let trial = 0; trial < 40; trial += 1) {
      const key = Uint8Array.from({ length: 32 }, (_, i) => (i * 29 + trial * 53 + 11) & 0xff);
      const input = Uint8Array.from({ length: 16 }, (_, i) => (i * 97 + trial * 17 + 3) & 0xff);
      chacha20Block(words(key), words(input), out);
      expect(blockHex(out), `trial ${trial}`).toBe(nodeBlock(key, input));
    }
  });
});
