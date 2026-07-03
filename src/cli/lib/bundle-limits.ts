/**
 * Single-source total-bundle-size limit for `boardsmith validate`/`publish`.
 *
 * This CLI-side check is advisory; the authoritative gate is the games
 * worker's upload handler at `~/ShufflewickPubGames/src/upload.ts:4`
 * (`const MAX_BUNDLE_SIZE = 50 * 1024 * 1024;`). This constant MUST mirror
 * that value exactly — CLI and server disagreeing lets a bundle that
 * "passes" `boardsmith validate` fail on the real publish gate (F21/CLIX-03,
 * T-135-10).
 */
export const MAX_BUNDLE_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * Shared oversize check for the COMPRESSED publish zip (WR-05). The server
 * gate applies to the uploaded zip's byte length, so both `boardsmith
 * validate` (in-memory zip of dist/) and `boardsmith publish` (the actual
 * upload payload) must compare exactly `zip.length` against the limit.
 *
 * Returns an actionable error message when over the limit, or null when OK.
 */
export function describeZipSizeViolation(zipLength: number): string | null {
  if (zipLength <= MAX_BUNDLE_SIZE) return null;
  return (
    `Compressed bundle (${formatMb(zipLength)}) exceeds the ${formatMb(MAX_BUNDLE_SIZE)} upload limit enforced by the publish server.\n` +
    'Reduce asset sizes (compress images/audio, prefer webp/ogg) or remove unused files from public/.'
  );
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
