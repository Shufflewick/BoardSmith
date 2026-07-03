/**
 * Canonical allowed-key set for `boardsmith.json`, plus a hand-rolled
 * did-you-mean suggester for unknown/misspelled top-level keys.
 *
 * The allowed-key set is derived from `boardsmith.schema.json` (single
 * source — see that file's header comment) so the validator and the shipped
 * schema can never drift apart (T-135-11). No new dependency is added: the
 * Levenshtein distance function below is a ~20-line classic DP
 * implementation (CLAUDE.md "no new dependencies without discussion").
 *
 * Consumed by `boardsmith validate` (this plan) and `boardsmith dev` startup
 * (Plan 06) so both surfaces warn/reject on the same unknown-key set.
 */

import schema from './boardsmith.schema.json';

/** The full set of legitimate top-level `boardsmith.json` keys. */
export const ALLOWED_TOP_LEVEL_KEYS: readonly string[] = Object.freeze(
  Object.keys((schema as { properties: Record<string, unknown> }).properties),
);

const ALLOWED_KEY_SET = new Set(ALLOWED_TOP_LEVEL_KEYS);

/**
 * Maximum edit distance for a did-you-mean suggestion. Beyond this the two
 * strings are considered unrelated rather than a likely typo.
 */
const SUGGESTION_THRESHOLD = 3;

/**
 * Classic dynamic-programming Levenshtein (edit) distance between two
 * strings. O(m*n) time/space — fine for the short key names involved here.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }

  return prev[n];
}

/**
 * Returns the nearest allowed top-level key to `unknown` (by edit distance),
 * or `undefined` if nothing is within `SUGGESTION_THRESHOLD`.
 */
export function suggestKey(unknown: string): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;

  for (const key of ALLOWED_TOP_LEVEL_KEYS) {
    const distance = levenshtein(unknown, key);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = key;
    }
  }

  return best !== undefined && bestDistance <= SUGGESTION_THRESHOLD ? best : undefined;
}

export interface UnknownKeyResult {
  key: string;
  suggestion?: string;
}

/**
 * Returns every top-level key present in `config` that is NOT in
 * ALLOWED_TOP_LEVEL_KEYS, each paired with a did-you-mean suggestion when one
 * is close enough. Order matches the key's order in `config`.
 */
export function findUnknownKeys(config: Record<string, unknown>): UnknownKeyResult[] {
  const results: UnknownKeyResult[] = [];

  for (const key of Object.keys(config)) {
    if (ALLOWED_KEY_SET.has(key)) continue;
    const suggestion = suggestKey(key);
    results.push(suggestion ? { key, suggestion } : { key });
  }

  return results;
}
