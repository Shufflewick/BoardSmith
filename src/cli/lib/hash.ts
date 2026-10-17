import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The sha256 of `data` as lowercase hex: what every CLI record that binds to a
 * file's or a text's content stores. One helper, so a change to how content is
 * hashed is made once (#531).
 */
export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * The sha256 of the files at `paths` under `root`, as lowercase hex. Paths are sorted, and each
 * path and length is hashed beside its bytes so moving content between files cannot collide.
 */
export function filesContentHash(root: string, paths: readonly string[]): string {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    const content = readFileSync(join(root, path));
    hash.update(`${path}\0${content.length}\0`);
    hash.update(content);
  }
  return hash.digest('hex');
}
