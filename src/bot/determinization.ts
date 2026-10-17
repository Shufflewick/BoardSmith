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
import { outermostConcealer } from '../engine/element/concealed-refs.js';
import { hasZoneVisibility } from '../engine/element/game-element.js';
import { canPlayerSee } from '../engine/element/visibility.js';

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

/** Every attribute, and the container, of one element the sandbox claims to know. */
interface KnownElement {
  element: GameElement;
  className: string;
  attributes: Map<string, string>;
  parent: GameElement | undefined;
}

/** Every element the sandbox currently claims to know, by id. */
type KnownWorld = Map<number, KnownElement>;

/** `HandCard#12 "card-11"`: how a refusal names an element. */
function nameOf(element: GameElement | undefined): string {
  if (!element) return 'no container';
  const name = element.name ? ` "${element.name}"` : '';
  return `${element.constructor.name}#${element._t.id}${name}`;
}

/** Nesting depth past which a fingerprint stops descending. */
const MAX_FINGERPRINT_DEPTH = 12;

/**
 * A stable, cycle-safe string for one attribute value, written the way a game
 * author writes it (`"red"`, `3`, `{back: "red"}`), so refusals can quote it.
 *
 * Elements collapse to their id: two samples that leave an attribute pointing
 * at the same element agree, whatever that element's own attributes did.
 */
function fingerprintValue(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const type = typeof value;
  if (type === 'string') return JSON.stringify(value);
  if (type === 'bigint') return `${String(value)}n`;
  if (type === 'number' || type === 'boolean') return String(value);
  if (type === 'function') return 'function';
  if (depth >= MAX_FINGERPRINT_DEPTH) return 'depth-limit';

  const asElement = value as { constructor?: { name: string }; _t?: { id?: unknown } };
  if (asElement._t && typeof asElement._t.id === 'number') return `${asElement.constructor?.name ?? ''}#${asElement._t.id}`;

  if (Array.isArray(value)) {
    return `[${value.map((v) => fingerprintValue(v, depth + 1)).join(', ')}]`;
  }
  const entries = Object.keys(value as object)
    .sort()
    .map((k) => `${keyOf(k)}: ${fingerprintValue((value as Record<string, unknown>)[k], depth + 1)}`);
  return `{${entries.join(', ')}}`;
}

/** An object key as an author writes it: bare when it can be, quoted otherwise. */
function keyOf(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
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
      element,
      className: element.constructor.name,
      attributes,
      parent: element._t.parent as GameElement | undefined,
    });
    for (const child of element._t.children) visit(child as GameElement);
  };

  visit(game as unknown as GameElement);
  return world;
}

/** One container's face-down placeholders of one look: class plus every attribute the seat holds. */
interface PlaceholderGroup {
  parent: GameElement | undefined;
  look: string;
  count: number;
}

/**
 * What the seat can see of each anonymous placeholder: its class and every
 * attribute it was told, such as its card back. Taken before sampling, so the
 * values a sampler fills in do not change a placeholder's look.
 */
function placeholderLooks(world: KnownWorld): Map<number, string> {
  const looks = new Map<number, string>();
  for (const [id, entry] of world) {
    if (id >= 0) continue;
    const known = [...entry.attributes]
      .filter(([, value]) => value !== 'undefined')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}: ${value}`);
    looks.set(id, known.length ? `${entry.className} with ${known.join(', ')}` : entry.className);
  }
  return looks;
}

/**
 * How many anonymous placeholders of each look each container holds.
 *
 * A hidden zone's children reach a seat with fresh negative ids precisely so
 * the seat cannot tell them apart, so which placeholder sits where is not
 * known; how many of each look each container holds is.
 */
function placeholderCounts(world: KnownWorld, looks: Map<number, string>): Map<string, PlaceholderGroup> {
  const counts = new Map<string, PlaceholderGroup>();
  for (const [id, look] of looks) {
    const parent = world.get(id)?.parent;
    const key = `${parent?._t.id}:${look}`;
    const prior = counts.get(key);
    if (prior) prior.count++;
    else counts.set(key, { parent, look, count: 1 });
  }
  return counts;
}

/** A container whose count of face-down placeholders of one look the sample changed, or `null`. */
function placeholderCountChange(before: KnownWorld, after: KnownWorld): string | null {
  const looks = placeholderLooks(before);
  const afterCounts = placeholderCounts(after, looks);
  for (const [key, prior] of placeholderCounts(before, looks)) {
    const now = afterCounts.get(key)?.count ?? 0;
    if (now !== prior.count) {
      return (
        `${nameOf(prior.parent)} held ${prior.count} face-down ${prior.look} ` +
        `placeholder${prior.count === 1 ? '' : 's'} and now ` +
        `holds ${now}. The seat can count them and see their class and back. A sampler may swap ` +
        `face-down placeholders that look alike between containers, or reorder them, but it may not ` +
        `change how many of each look a container holds.`
      );
    }
  }
  return null;
}

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

/** The first element the sample created where the seat would see it, or `null`. */
function visibleNewElement(before: KnownWorld, after: KnownWorld, seat: number): string | null {
  for (const [id, now] of after) {
    if (before.has(id)) continue;
    const concealed = outermostConcealer(now.element, seat);
    if (concealed && !now.element.isVisibleTo(seat)) continue;
    const seen = concealed ? 'that element itself' : 'what that container holds';
    return (
      `it added ${nameOf(now.element)} to ${nameOf(now.parent)}. The seat can see ${seen}, ` +
      `so it knows that element was not there. ` +
      `A sampler may create elements only where the seat cannot see them, such as a hidden deck.`
    );
  }
  return null;
}

/**
 * Whether the seat's view says how many children this container holds, as
 * `redactTreeForSeat` decides: not inside something concealed, not itself
 * hidden, and not a zone whose 'hidden' mode keeps its size secret.
 */
function countVisibleTo(container: GameElement, seat: number): boolean {
  if (outermostConcealer(container, seat) || !container.isVisibleTo(seat)) return false;
  const zone = hasZoneVisibility(container) ? container.getZoneVisibility() : undefined;
  return zone?.mode !== 'hidden' || canPlayerSee(zone, seat, container.getEffectiveOwner()?.seat);
}

/** How many children each element of a world holds. */
function childCounts(world: KnownWorld): Map<GameElement | undefined, number> {
  const counts = new Map<GameElement | undefined, number>();
  for (const { parent } of world.values()) counts.set(parent, (counts.get(parent) ?? 0) + 1);
  return counts;
}

/** The first container the seat can count whose number of children the sample changed, or `null`. */
function childCountChange(before: KnownWorld, after: KnownWorld, seat: number): string | null {
  const priorCounts = childCounts(before);
  const nowCounts = childCounts(after);
  for (const { element } of before.values()) {
    const prior = priorCounts.get(element) ?? 0;
    const now = nowCounts.get(element) ?? 0;
    if (now === prior || !countVisibleTo(element, seat)) continue;
    return (
      `${nameOf(element)} held ${prior} element${prior === 1 ? '' : 's'} and now holds ${now}. ` +
      `The seat can count what that container holds even where it cannot see them, ` +
      `so a sampler may not change how many it holds.`
    );
  }
  return null;
}

/** The first way `after` contradicts `before`, or `null` if it does not. */
function findContradiction(before: KnownWorld, after: KnownWorld, seat: number): string | null {
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
    if (id >= 0 && now.parent?._t.id !== prior.parent?._t.id) {
      return (
        `it moved ${nameOf(now.element)} from ${nameOf(prior.parent)} to ${nameOf(now.parent)}. ` +
        `The seat can see where that element is. A sampler may reorder the children of a container ` +
        `and may fill in what a face-down element is, but it may not move an element the seat can see ` +
        `into a different container.`
      );
    }
    const change = attributeChange(id, prior, now);
    if (change) return change;
  }
  return visibleNewElement(before, after, seat) ?? childCountChange(before, after, seat);
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

  const contradiction = findContradiction(before, recordKnownWorld(sandbox), seat);
  if (contradiction) {
    throw new DeterminizationError(
      `The determinize sampler for seat ${seat} produced a world that contradicts what the ` +
      `seat can see: ${contradiction}\n\n` +
      `  A sampler may write only attributes this sandbox was never told (the ones ` +
      `element.isAttributeRedacted(key) reports true for) and create elements only where the ` +
      `seat cannot see them. Everything else is information the ` +
      `seat already holds, and a search over a world that disagrees with it scores moves that ` +
      `do not exist.`,
    );
  }
}
