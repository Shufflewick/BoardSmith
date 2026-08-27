/**
 * Determinization — sampling a concrete world out of a seat's information set
 * so an MCTS bot can SEARCH hidden state instead of skipping it (#73).
 *
 * The engine already tells a search sandbox precisely what it was not told:
 * a redacted attribute restores as an accessor that throws
 * `RedactedAttributeError` on read, and `element.isAttributeRedacted(key)`
 * asks without reading (#19). That is the whole substrate this needs. A
 * sampler's job is to turn "not told" into "supposed", once per playout, and
 * the search aggregates over the suppositions.
 *
 * The one rule is what makes this honest rather than a licensed version of the
 * defect #19 fixed:
 *
 *   A sampler may write ONLY attributes the sandbox was never told.
 *   Anything the seat legitimately knows must survive the sample unchanged.
 *
 * That rule is checkable without knowing anything about the game, and it is
 * checked here on every sample. A sampler that breaks it is not producing a
 * hypothesis; it is producing a world that contradicts what the seat can see,
 * and scoring moves in it is worse than not searching them at all.
 */

import type { Game } from '../engine/index.js';
import type { GameElement } from '../engine/index.js';
import type { DeterminizeSampler } from './types.js';

/**
 * A game's determinization sampler broke the one contract it has (#73).
 *
 * Deliberately NOT a `NotSimulableError`: that family means "this information
 * state cannot answer the question", and the engine's answer to it is to drop
 * the move quietly. A sampler that invents a contradictory world is a bug in
 * the game, and a quietly dropped move would hide it for the whole session.
 */
export class DeterminizationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DeterminizationError';
  }
}

/** Every attribute of every element the sandbox currently claims to know. */
type KnownWorld = Map<number, { className: string; attributes: Map<string, string> }>;

/** Nesting depth past which a fingerprint stops descending. */
const MAX_FINGERPRINT_DEPTH = 12;

/**
 * A stable, cycle-safe string for one attribute value.
 *
 * Elements collapse to their id: two samples that leave an attribute pointing
 * at the same element agree, whatever that element's own attributes did.
 */
function fingerprintValue(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
    return `${type}:${String(value)}`;
  }
  if (type === 'function') return 'function';
  if (depth >= MAX_FINGERPRINT_DEPTH) return 'depth-limit';

  const asElement = value as { _t?: { id?: unknown } };
  if (asElement._t && typeof asElement._t.id === 'number') return `@${asElement._t.id}`;

  if (Array.isArray(value)) {
    return `[${value.map((v) => fingerprintValue(v, depth + 1)).join(',')}]`;
  }
  const entries = Object.keys(value as object)
    .sort()
    .map((k) => `${k}=${fingerprintValue((value as Record<string, unknown>)[k], depth + 1)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Record what this copy of the game knows, element by element.
 *
 * A redacted attribute is an own NON-ENUMERABLE accessor, so `Object.keys`
 * skips it and it never enters the record — which is exactly right: the whole
 * point is that it is not known, and writing it is the sampler's job. Reading
 * it here would throw, and would also be the cheating this guards against.
 */
function recordKnownWorld(game: Game): KnownWorld {
  const world: KnownWorld = new Map();

  const visit = (element: GameElement): void => {
    const Class = element.constructor as { unserializableAttributes?: string[] };
    const unserializable = new Set(Class.unserializableAttributes ?? []);
    const attributes = new Map<string, string>();
    for (const key of Object.keys(element)) {
      if (key.startsWith('_') || unserializable.has(key)) continue;
      attributes.set(key, fingerprintValue((element as unknown as Record<string, unknown>)[key]));
    }
    world.set(element._t.id, { className: element.constructor.name, attributes });
    for (const child of element._t.children) visit(child as GameElement);
  };

  visit(game as unknown as GameElement);
  return world;
}

/** The first way `after` contradicts `before`, or `null` if it does not. */
function findContradiction(before: KnownWorld, after: KnownWorld): string | null {
  for (const [id, prior] of before) {
    const now = after.get(id);
    if (!now) {
      return (
        `it removed ${prior.className}#${id} from the tree. The seat can see that element, ` +
        `so a world without it is not a world the seat could be in.`
      );
    }
    for (const [key, value] of prior.attributes) {
      if (!now.attributes.has(key)) {
        return (
          `it deleted ${prior.className}#${id}.${key}, which this seat was told. ` +
          `A sampler may add what was withheld; it may not take away what was given.`
        );
      }
      const nowValue = now.attributes.get(key)!;
      if (nowValue !== value) {
        return (
          `it changed ${prior.className}#${id}.${key} from ${value} to ${nowValue}. ` +
          `That attribute is not redacted in this sandbox, so the seat already knows it — ` +
          `overwriting it invents a world the seat can see is wrong.`
        );
      }
    }
  }
  return null;
}

/**
 * Sample one world into `sandbox` and prove it is still a world this seat
 * could be in.
 *
 * `sandbox` MUST be the seat's redacted clone, never the authoritative game:
 * that is what makes it impossible for a sampler to read the truth it is
 * supposed to be guessing. `MCTSBot` is the only caller and builds it from
 * `createSnapshot(..., { forSeat })`.
 *
 * @param sandbox - The seat's redacted search sandbox, restored as a live game
 * @param seat - 1-indexed seat the search belongs to
 * @param sampler - The game's declared `BotStrategy.determinize`
 * @param rng - Seeded [0, 1) source, so a seeded search stays reproducible
 * @throws {DeterminizationError} if the sampler throws, or contradicts the view
 */
export function applyDeterminization(
  sandbox: Game,
  seat: number,
  sampler: DeterminizeSampler,
  rng: () => number,
): void {
  const before = recordKnownWorld(sandbox);

  try {
    sampler(sandbox, seat, rng);
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new DeterminizationError(
      `The determinize sampler for seat ${seat} threw while sampling a world.\n\n` +
      `  ${detail}\n\n` +
      `  A sampler runs inside the seat's REDACTED sandbox, so every attribute the seat was ` +
      `not told throws on read. Ask element.isAttributeRedacted(key) before reading, and ` +
      `derive the sample from what the seat can actually see.`,
      { cause: error },
    );
  }

  const contradiction = findContradiction(before, recordKnownWorld(sandbox));
  if (contradiction) {
    throw new DeterminizationError(
      `The determinize sampler for seat ${seat} produced a world that contradicts what the ` +
      `seat can see: ${contradiction}\n\n` +
      `  A sampler may write ONLY attributes this sandbox was never told — the ones ` +
      `element.isAttributeRedacted(key) reports true for. Everything else is information the ` +
      `seat already holds, and a search over a world that disagrees with it scores moves that ` +
      `do not exist.`,
    );
  }
}
