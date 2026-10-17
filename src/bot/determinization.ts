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
import { changing } from '../engine/element/state-version.js';

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

/** Every attribute, and the container, of every element the sandbox currently claims to know. */
type KnownWorld = Map<number, {
  className: string;
  label: string;
  attributes: Map<string, string>;
  parent: GameElement | undefined;
}>;

/** `HandCard#12 "card-11"`: how a refusal names an element. */
function nameOf(element: GameElement | undefined): string {
  if (!element) return 'no container';
  const name = element.name ? ` "${element.name}"` : '';
  return `${element.constructor.name}#${element._t.id}${name}`;
}

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
    world.set(element._t.id, {
      className: element.constructor.name,
      label: nameOf(element),
      attributes,
      parent: element._t.parent as GameElement | undefined,
    });
    for (const child of element._t.children) visit(child as GameElement);
  };

  visit(game as unknown as GameElement);
  return world;
}

/**
 * How many anonymous placeholders of each class each container holds.
 *
 * A hidden zone's children reach a seat with fresh negative ids precisely so
 * the seat cannot tell them apart, so which placeholder sits where is not
 * known; how many each container holds is.
 */
function placeholderCounts(world: KnownWorld): Map<string, { parent: string; className: string; count: number }> {
  const counts = new Map<string, { parent: string; className: string; count: number }>();
  for (const [id, entry] of world) {
    if (id >= 0) continue;
    const key = `${entry.parent?._t.id}:${entry.className}`;
    const prior = counts.get(key);
    if (prior) prior.count++;
    else counts.set(key, { parent: nameOf(entry.parent), className: entry.className, count: 1 });
  }
  return counts;
}

/** A container whose count of face-down placeholders the sample changed, or `null`. */
function placeholderCountChange(before: KnownWorld, after: KnownWorld): string | null {
  const afterCounts = placeholderCounts(after);
  for (const [key, prior] of placeholderCounts(before)) {
    const now = afterCounts.get(key)?.count ?? 0;
    if (now !== prior.count) {
      return (
        `${prior.parent} held ${prior.count} face-down ${prior.className} placeholders and now ` +
        `holds ${now}. The seat can count them. A sampler may swap face-down placeholders between ` +
        `containers or reorder them, but it may not change how many each container holds.`
      );
    }
  }
  return null;
}

type KnownElement = KnownWorld extends Map<number, infer E> ? E : never;

/** The first attribute of one element the sample deleted or changed, or `null`. */
function attributeChange(id: number, prior: KnownElement, now: KnownElement): string | null {
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
  return null;
}

/** The first way `after` contradicts `before`, or `null` if it does not. */
function findContradiction(before: KnownWorld, after: KnownWorld): string | null {
  const countChange = placeholderCountChange(before, after);
  if (countChange) return countChange;

  for (const [id, prior] of before) {
    const now = after.get(id);
    if (!now) {
      return (
        `it removed ${prior.className}#${id} from the tree. The seat can see that element, ` +
        `so a world without it is not a world the seat could be in.`
      );
    }
    if (id >= 0 && now.parent !== prior.parent) {
      return (
        `it moved ${prior.label} from ${nameOf(prior.parent)} to ${nameOf(now.parent)}. ` +
        `The seat can see where that element is. A sampler may reorder the children of a container ` +
        `and may fill in what a face-down element is, but it may not move an element the seat can see ` +
        `into a different container.`
      );
    }
    const change = attributeChange(id, prior, now);
    if (change) return change;
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
    changing(sandbox._ctx, () => sampler(sandbox, seat, rng));
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
