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
