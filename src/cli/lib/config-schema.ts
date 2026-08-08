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

interface ObjectSchema {
  properties: Record<string, unknown>;
}

/**
 * Every allowed-key list in this module is read out of the shipped schema, so
 * a block's keys are declared in exactly one place — the JSON an author's
 * editor also validates against.
 */
function keysOf(block: unknown): readonly string[] {
  return Object.freeze(Object.keys((block as ObjectSchema).properties));
}

const rootSchema = schema as unknown as ObjectSchema & {
  definitions: Record<string, unknown>;
};

/** The full set of legitimate top-level `boardsmith.json` keys. */
export const ALLOWED_TOP_LEVEL_KEYS: readonly string[] = keysOf(rootSchema);

/** Legitimate keys inside the persistent-world block. */
export const ALLOWED_WORLD_KEYS: readonly string[] = keysOf(rootSchema.properties.world);

/** Legitimate keys inside the `roundDeadline` block. */
export const ALLOWED_ROUND_DEADLINE_KEYS: readonly string[] = keysOf(
  rootSchema.properties.roundDeadline,
);

/**
 * Legitimate keys inside a platform-submitted action declaration —
 * `idleAction`, `world.resolveAction`, `world.enrolAction`.
 */
export const ALLOWED_NAMED_ACTION_KEYS: readonly string[] = keysOf(
  rootSchema.definitions.namedAction,
);

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
 * Returns the nearest key in `candidates` to `unknown` (by edit distance), or
 * `undefined` if nothing is within `SUGGESTION_THRESHOLD`. Defaults to the
 * top-level key set; nested blocks pass their own.
 */
export function suggestKey(
  unknown: string,
  candidates: readonly string[] = ALLOWED_TOP_LEVEL_KEYS,
): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;

  for (const key of candidates) {
    const distance = levenshtein(unknown, key);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = key;
    }
  }

  return best !== undefined && bestDistance <= SUGGESTION_THRESHOLD ? best : undefined;
}

/**
 * Not exported: nothing outside this module names the type — callers
 * destructure `{ key, suggestion }` off the returned array. Exporting it would
 * read as public API that no consumer has.
 */
interface UnknownKeyResult {
  key: string;
  suggestion?: string;
}

/**
 * Returns every top-level key present in `config` that is NOT in
 * ALLOWED_TOP_LEVEL_KEYS, each paired with a did-you-mean suggestion when one
 * is close enough. Order matches the key's order in `config`.
 */
export function findUnknownKeys(config: Record<string, unknown>): UnknownKeyResult[] {
  return findUnknownKeysIn(config, ALLOWED_TOP_LEVEL_KEYS);
}

/**
 * The same unknown-key + did-you-mean pass against an arbitrary allowed-key
 * list, for the nested blocks (`world`, `roundDeadline`, and the named-action
 * declarations inside them). A typo one level down is exactly as silent as a
 * typo at the top level, so it gets exactly the same treatment.
 */
export function findUnknownKeysIn(
  block: Record<string, unknown>,
  allowed: readonly string[],
): UnknownKeyResult[] {
  const allowedSet = new Set(allowed);
  const results: UnknownKeyResult[] = [];

  for (const key of Object.keys(block)) {
    if (allowedSet.has(key)) continue;
    const suggestion = suggestKey(key, allowed);
    results.push(suggestion ? { key, suggestion } : { key });
  }

  return results;
}
