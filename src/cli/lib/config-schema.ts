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

/** A top-level property, with the sink disposition every one of them carries. */
interface SinkAnnotatedProperty {
  'x-convex-sink'?: boolean;
}

/** A top-level property that names a file the bundle must actually carry. */
interface AssetAnnotatedProperty {
  'x-asset-path'?: boolean;
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

/**
 * The keys the publishing platform's CONVEX sink consumes — read straight off
 * each schema property's `x-convex-sink` annotation, which the schema requires
 * on every top-level property (`validate.test.ts` fails a property that omits
 * it).
 *
 * `buildInitiateManifest` (publish-api.ts) forwards EXACTLY this set, so
 * marking a key here is the whole of what it takes to make it reach the
 * platform. There is no second list to remember: `asyncPlay` and then
 * `roundDeadline` were each dropped silently by a hand-maintained one, the
 * second time inside the function written to prevent the first.
 */
export const CONVEX_SINK_KEYS: readonly string[] = Object.freeze(
  Object.entries((schema as unknown as ObjectSchema).properties)
    .filter(([, property]) => (property as SinkAnnotatedProperty)['x-convex-sink'] === true)
    .map(([key]) => key),
);

/**
 * The top-level keys whose value is a PATH TO A FILE the bundle must carry —
 * read off each schema property's `x-asset-path` annotation.
 *
 * `boardsmith validate` fails when one of these resolves to nothing. The
 * scaffold used to emit `thumbnail: './public/thumbnail.png'` for a file it
 * never created, `deriveManifest` stamped it into every dist/manifest.json,
 * and every gate stayed green — for eight games. Marking a key here is the
 * whole of what it takes for the gate to cover a new asset key.
 */
export const ASSET_PATH_KEYS: readonly string[] = Object.freeze(
  Object.entries((schema as unknown as ObjectSchema).properties)
    .filter(([, property]) => (property as AssetAnnotatedProperty)['x-asset-path'] === true)
    .map(([key]) => key),
);

/** Legitimate keys inside the `roundDeadline` block. */
export const ALLOWED_ROUND_DEADLINE_KEYS: readonly string[] = keysOf(
  rootSchema.properties.roundDeadline,
);

/**
 * Legitimate keys inside a platform-submitted action declaration —
 * `idleAction`. The world block used to declare two more; the round
 * architecture that needed them is deleted.
 */
export const ALLOWED_NAMED_ACTION_KEYS: readonly string[] = keysOf(
  rootSchema.definitions.namedAction,
);

/** The platforms a `platforms` block may hold ids for, which are the platforms publish can target. */
export const ALLOWED_PLATFORM_KEYS: readonly string[] = keysOf(rootSchema.properties.platforms);

/** Legitimate keys inside one platform's block of `platforms`. */
export const ALLOWED_PLATFORM_ID_KEYS: readonly string[] = keysOf(rootSchema.definitions.platformIds);

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

/** Why a top-level platform id is refused and where it goes (#704); `publish` refuses with the same words. */
export function topLevelIdMessage(key: 'gameId' | 'publisherId'): string {
  return (
    `Unknown key '${key}' — each publishing platform keeps its own ids, because dev and prod are separate ` +
    'deployments. Move it under "platforms.dev" or "platforms.prod", whichever platform gave it, e.g. ' +
    '"platforms": { "prod": { "gameId": "...", "publisherId": "..." } }. If you are not sure which platform it ' +
    'belongs to, delete it and publish again with --publisher <slug>; the platform finds the game by its slug.'
  );
}

/** Keys boardsmith.json once carried, each with where its job went (CLIX-01). */
const RETIRED_KEY_MESSAGES: Readonly<Record<string, string>> = {
  ui:
    "Unknown key 'ui' — a game's UIs are declared in src/ui/uis.ts (defineGameUIs), "
    + 'which is the single source of truth for which boards exist and which one ships. '
    + 'Remove this key from boardsmith.json.',
  scoreboard:
    "Unknown key 'scoreboard': nothing in BoardSmith or the platform ever read it. "
    + 'Remove this key from boardsmith.json.',
  playerCount:
    "Unknown key 'playerCount' — player count is now derived from your gameDefinition (compiled rules), remove this key from boardsmith.json.",
  world:
    "Unknown key 'world' — a project says it is a persistent world with \"backend\": \"world\", "
    + 'and everything else about the world is declared in your gameDefinition\'s `world` block '
    + '(compiled rules): `maxPlayers`, the number the runtime actually enforces, and '
    + '`stateVersion`, your statement about what this version makes of a live world\'s stored '
    + 'state. The manifest\'s copies of both are derived from it at build. Remove this key from '
    + 'boardsmith.json.',
  bot:
    "Unknown key 'bot' — whether a seat may be played by a bot is DERIVED from your "
    + 'gameDefinition\'s `bot` block (compiled rules) and published as `capabilities.bots`, so a '
    + 'manifest can no longer claim a bot the bundle does not ship. It is a table capability: a '
    + 'world backend has no bots. Remove this key from boardsmith.json.',
  persistence:
    "Unknown key 'persistence' — whether state survives a sitting is DERIVED from your "
    + 'gameDefinition\'s `persistence` (compiled rules), which is what `boardsmith dev` already '
    + 'read, and published as `capabilities.crossSessionState`. Remove this key from '
    + 'boardsmith.json.',
  categories:
    "Unknown key 'categories' — replaced by 'audience' (a single string: who the game is for). Genre/theme/mechanism labels belong in 'tags'.",
  estimatedDuration:
    "Unknown key 'estimatedDuration' — replaced by 'playtime': { \"min\": <minutes>, \"max\": <minutes> }.",
  asyncPlay:
    "Unknown key 'asyncPlay': every game may now be played with long gaps between moves, and "
    + 'the host sets the time each turn allows. Remove this key from boardsmith.json.',
  joinInProgress:
    "Unknown key 'joinInProgress': whether a player may join a session already underway is now "
    + "the host's decision, not the rules'. Remove this key from boardsmith.json.",
  gameId: topLevelIdMessage('gameId'),
  publisherId: topLevelIdMessage('publisherId'),
};

/**
 * One sentence per top-level key boardsmith.json may not carry: where a retired
 * key's job went, or the nearest allowed key. `validate` and `build` refuse with
 * these words and `dev` warns with them, so the three cannot disagree.
 */
export function unknownKeyMessages(config: Record<string, unknown>): string[] {
  return findUnknownKeys(config).map(({ key, suggestion }) =>
    Object.hasOwn(RETIRED_KEY_MESSAGES, key)
      ? RETIRED_KEY_MESSAGES[key]
      : suggestion
        ? `Unknown key '${key}' — did you mean '${suggestion}'?`
        : `Unknown key '${key}' — not a recognized boardsmith.json field.`,
  );
}
