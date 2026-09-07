/**
 * Single-source mirror of ShufflewickPub's bundle gates.
 *
 * There are TWO different servers with TWO different gates, and conflating
 * them is what #220/#221 reported:
 *
 * 1. The games worker's UPLOAD gate — `ShufflewickPub/games/src/upload.ts` —
 *    applies to every bundle, table or world. It gates the compressed zip's
 *    byte length plus three zip-bomb ceilings on what that zip inflates to.
 * 2. The table executor's REQUEST gate —
 *    `ShufflewickPub/executor/src/validation.ts` — applies ONLY to the table
 *    backend, because only a table session ships `rules.js` inside a JSON
 *    request body. A world's rules are fetched from the bundle store by
 *    `games/src/world-session.ts#fetchRules` and never travel in an envelope,
 *    so the executor's cap is not a world's cap.
 *
 * Every constant here MUST mirror the named server file exactly. A CLI that
 * disagrees with the server either rejects bundles the platform would accept
 * or passes bundles that fail at play time (F21/CLIX-03, T-135-10).
 */

/** `games/src/upload.ts` — `MAX_BUNDLE_SIZE`, the uploaded zip's byte length. */
export const MAX_UPLOAD_ZIP_BYTES = 200 * 1024 * 1024;

/** `games/src/upload.ts` — `MAX_ENTRIES`, files in the zip. */
export const MAX_ZIP_ENTRIES = 2000;

/** `games/src/upload.ts` — `MAX_ENTRY_BYTES`, one inflated file. */
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;

/** `games/src/upload.ts` — `MAX_TOTAL_UNCOMPRESSED`, the whole inflated tree. */
const MAX_TOTAL_UNCOMPRESSED_BYTES = 300 * 1024 * 1024;

/**
 * `executor/src/validation.ts` — `MAX_BUNDLE_SIZE`. TABLE BACKEND ONLY, and
 * measured on the JSON-ENCODED form, not the bytes on disk: see
 * `encodedRulesBytes`.
 */
export const MAX_TABLE_RULES_ENCODED_BYTES = 1_048_576;

/**
 * Where the "you are running out of room" warning starts. An author shipping
 * bulk data in `rules.js` — a puzzle library, a card database, a wordlist —
 * should learn about the ceiling while there is still room to react, not on
 * the build that crosses it.
 */
const TABLE_RULES_WARN_FRACTION = 0.8;

/**
 * The bytes `rules.js` occupies IN THE EXECUTOR REQUEST.
 *
 * The bundle travels to the executor as a JSON string, so `JSON.stringify`
 * gives exactly the quoted, escaped form the raw body carries, and
 * `TextEncoder` gives its UTF-8 byte length rather than JS string `.length`
 * (UTF-16 code units). Every `"`, `\` and newline costs one extra byte and a
 * control character costs six, so a string-heavy `rules.js` encodes 5-15%
 * larger than it sits on disk. Measuring the file on disk instead is how a
 * bundle passed `validate`, passed `publish`, and then failed EVERY start.
 */
export function encodedRulesBytes(source: string): number {
  return new TextEncoder().encode(JSON.stringify(source)).length;
}

/**
 * Shared oversize check for the COMPRESSED publish zip (WR-05). The server
 * gate applies to the uploaded zip's byte length, so both `boardsmith
 * validate` (in-memory zip of dist/) and `boardsmith publish` (the actual
 * upload payload) must compare exactly `zip.length` against the limit.
 *
 * Returns an actionable error message when over the limit, or null when OK.
 */
export function describeZipSizeViolation(zipLength: number): string | null {
  if (zipLength <= MAX_UPLOAD_ZIP_BYTES) return null;
  return (
    `Compressed bundle (${formatMb(zipLength)}) exceeds the ${formatMb(MAX_UPLOAD_ZIP_BYTES)} upload limit enforced by the publish server.\n` +
    'Reduce asset sizes (compress images/audio, prefer webp/ogg) or remove unused files from public/.'
  );
}

/**
 * The three zip-bomb ceilings the games worker applies to the INFLATED tree,
 * checked here on the files `publish` is about to zip. A bundle that trips one
 * of these compresses small enough to pass the zip gate and is still refused
 * on upload, so checking only the zip leaves that failure to the server.
 */
export function describeUncompressedViolations(files: Map<string, Uint8Array>): string[] {
  const issues: string[] = [];

  if (files.size > MAX_ZIP_ENTRIES) {
    issues.push(
      `Bundle has ${files.size} files, over the publish server's ${MAX_ZIP_ENTRIES}-file ceiling.\n` +
      'Remove unused files from public/, or combine many small assets into a sprite sheet or atlas.',
    );
  }

  let total = 0;
  for (const [path, bytes] of files) {
    total += bytes.length;
    if (bytes.length > MAX_ENTRY_BYTES) {
      issues.push(
        `${path} (${formatMb(bytes.length)}) is over the publish server's ${formatMb(MAX_ENTRY_BYTES)} per-file ceiling.\n` +
        'Compress or split that file — the ceiling applies to the uncompressed file, not the zip.',
      );
    }
  }

  if (total > MAX_TOTAL_UNCOMPRESSED_BYTES) {
    issues.push(
      `Bundle expands to ${formatMb(total)}, over the publish server's ${formatMb(MAX_TOTAL_UNCOMPRESSED_BYTES)} uncompressed ceiling.\n` +
      'The ceiling applies to the inflated tree, so compressing the zip does not help — remove or shrink assets.',
    );
  }

  return issues;
}

/**
 * The table executor's `rules.js` gate, in the executor's own units.
 *
 * Returns an actionable error when over the limit, or null when OK. The
 * message names the encoding overhead as the cause, because "your 900 KB file
 * is 1.03 MB" is otherwise unexplainable from anything the author can see.
 */
export function describeTableRulesViolation(rawBytes: number, encoded: number): string | null {
  if (encoded <= MAX_TABLE_RULES_ENCODED_BYTES) return null;
  return (
    `rules.js is ${formatKb(encoded)} as the executor measures it, over the ${formatKb(MAX_TABLE_RULES_ENCODED_BYTES)} limit ` +
    `(it is ${formatKb(rawBytes)} on disk).\n` +
    'A bundle travels to the executor as a JSON string, so every quote, backslash and newline in rules.js costs an extra byte ' +
    'and each control character costs six — string-heavy rules encode larger than they look on disk.\n' +
    'Move bulk data (puzzle libraries, card databases, wordlists) out of rules.js and load it as a bundled asset, or shrink it.'
  );
}

/**
 * The warning band below the same gate. Returns null once the bundle is either
 * comfortably under or actually over — an over-limit bundle gets the error
 * above instead, and saying both would be noise.
 */
export function describeTableRulesWarning(rawBytes: number, encoded: number): string | null {
  const floor = MAX_TABLE_RULES_ENCODED_BYTES * TABLE_RULES_WARN_FRACTION;
  if (encoded <= floor || encoded > MAX_TABLE_RULES_ENCODED_BYTES) return null;
  const percent = Math.round((encoded / MAX_TABLE_RULES_ENCODED_BYTES) * 100);
  return (
    `rules.js is at ${percent}% of the executor's ${formatKb(MAX_TABLE_RULES_ENCODED_BYTES)} limit ` +
    `(${formatKb(encoded)} encoded, ${formatKb(rawBytes)} on disk). ` +
    'Quotes, backslashes and newlines each cost an extra byte on the wire, so the encoded number is the one that counts.'
  );
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
