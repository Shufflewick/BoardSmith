import { createHash } from 'node:crypto';

/**
 * The sha256 of `data` as lowercase hex: what every CLI record that binds to a
 * file's or a text's content stores. One helper, so a change to how content is
 * hashed is made once (#531).
 */
export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
