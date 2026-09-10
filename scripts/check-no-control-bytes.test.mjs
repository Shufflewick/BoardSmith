/**
 * #243: NO TRACKED TEXT FILE MAY HOLD A LITERAL CONTROL BYTE.
 *
 * A single NUL is enough for git to classify a file as binary, and a binary
 * file has no diff in `git diff`, `git log -p`, `git show` or any review UI.
 * That is how `src/cli/lib/dupes-baseline.ts`, the module that owns the
 * committed and deliberately reviewable duplication record, became the least
 * reviewable file in the repository, with `src/cli/lib/choice-cardinality.ts`
 * alongside it. Both used NUL as a key separator, which is the right separator:
 * no source text can hold one, so no fragment can forge the delimiter. Only the
 * spelling was wrong. `'\u0000'` builds the identical string and leaves the
 * file text.
 *
 * The same trap is open for every other control byte written literally, so this
 * gate is about spelling rather than about NUL: write the escape, and keep the
 * character out of the bytes on disk.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The bytes below U+0020 a text file may legitimately hold.
 *
 * Tab, line feed and carriage return are structure, not content. Every other
 * byte in that range, and U+007F, is a control character that belongs in a
 * string literal as an escape and never in the file's bytes.
 */
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

/**
 * The extensions whose contents are genuinely not text.
 *
 * A denylist rather than an allowlist, so a source file of a kind this
 * repository does not use yet is gated the moment it lands instead of being
 * exempt until somebody remembers to add its extension.
 */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.pdf',
  '.mp3',
  '.wav',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.zip',
  '.gz',
]);

/** Every file git tracks that is meant to be read as text. */
function trackedTextFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: PROJECT_ROOT, encoding: 'utf-8' })
    .split('\u0000')
    .filter((path) => path.length > 0 && !BINARY_EXTENSIONS.has(extname(path).toLowerCase()));
}

/** The offsets of the control bytes in a buffer, so a failure names the character. */
function controlByteOffsets(bytes) {
  const offsets = [];
  for (let offset = 0; offset < bytes.length; offset += 1) {
    const byte = bytes[offset];
    if ((byte < 0x20 && !ALLOWED.has(byte)) || byte === 0x7f) offsets.push(offset);
  }
  return offsets;
}

/** One file's offenders, described the way a reader needs to see them. */
function offendersIn(relative) {
  const bytes = readFileSync(join(PROJECT_ROOT, relative));
  return controlByteOffsets(bytes).map(
    (offset) =>
      `${relative}: byte 0x${bytes[offset].toString(16).padStart(2, '0')} at offset ${offset}`,
  );
}

describe('no literal control bytes in tracked text files (#243)', () => {
  it('finds none, so every tracked text file still diffs as text', () => {
    const offenders = trackedTextFiles().flatMap(offendersIn);

    expect(
      offenders,
      "Write the character as an escape (for example '\\u0000') instead of putting the byte in the file. One control byte makes git treat the file as binary, which removes its diff from every review surface.",
    ).toEqual([]);
  });

  it('bites on the byte this gate exists for, so the scan is not vacuous', () => {
    const withNul = Buffer.from('const separator = "\u0000";\n', 'utf-8');
    const withEscape = Buffer.from(String.raw`const separator = "\u0000";` + '\n', 'utf-8');

    expect(controlByteOffsets(withNul)).toEqual([19]);
    expect(controlByteOffsets(withEscape)).toEqual([]);
  });
});
