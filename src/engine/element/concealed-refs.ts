/**
 * ELEMENT REFERENCES, AS ONE SEAT MAY READ THEM (#752, #1043).
 *
 * `encodeValue` writes a reference as the element's true branch, or in a world
 * its real id, once for every seat. Inside something a seat cannot see, that
 * gives away the element's place (a shuffled deck's order, a hidden zone's
 * size, a card's slot in an opponent's hand) or its identity, so the seat's
 * copy names the outermost container that conceals it instead, the rule flow
 * variables follow (#726). A reference the seat can follow is kept as written.
 * One rule for every payload a seat receives: its tree (attributes, settings,
 * animation data) and its message log.
 */
import type { Game } from './game.js';
import { hasZoneVisibility, ownVisibilityAllows, type GameElement } from './game-element.js';
import { canPlayerSee } from './visibility.js';

/**
 * `value` with every element reference in it rewritten for the seat at
 * `position` (-1 for a spectator). Returns `value` itself, not a copy, where
 * nothing changed, since a fan-out runs this over every seat's whole tree.
 * Marks no world partition reached: building a view is not a command's read
 * (ShufflewickPub #295), so every lookup here goes through `_t` and the id index.
 */
export function concealRefsForSeat<T>(value: T, game: Game, position: number): T {
  if (value === null || typeof value !== 'object') return value;
  const concealed = concealedRef(value, game, position);
  if (concealed) return concealed as T;
  let copy: Record<string, unknown> | undefined;
  for (const key of Object.keys(value)) {
    const entry = (value as Record<string, unknown>)[key];
    const next = concealRefsForSeat(entry, game, position);
    if (next === entry) continue;
    copy ??= (Array.isArray(value) ? [...value] : { ...value }) as Record<string, unknown>;
    // defineProperty, so a `__proto__` key stays an own entry (#761).
    Object.defineProperty(copy, key, { value: next, writable: true, enumerable: true, configurable: true });
  }
  return (copy ?? value) as T;
}

/** The concealer's reference, in the form `value` was written in, when `value` is a reference the seat cannot follow. */
function concealedRef(value: object, game: Game, position: number): object | undefined {
  const { __elementRef: branch, __elementId: id } = value as { __elementRef?: unknown; __elementId?: unknown };
  // shortcut: a world reference to an element not resident here (an index miss) is left as written; its ancestors are not loaded.
  const element =
    typeof branch === 'string' ? inTreeAt(game, branch) : typeof id === 'number' ? game._ctx._elementsById.get(id) : undefined;
  const concealer = element && outermostConcealer(element, position);
  if (!concealer) return undefined;
  return typeof branch === 'string' ? { __elementRef: concealer.branch() } : { __elementId: concealer.id };
}

/** The element at a branch in the game's tree, or undefined (a pile branch included). */
function inTreeAt(game: Game, branch: string): GameElement | undefined {
  if (branch === '') return game;
  let element: GameElement | undefined = game;
  for (const index of branch.split('/')) element = element?._t.children[Number(index)];
  return element;
}

/**
 * The outermost ancestor whose view for this seat leaves out or anonymizes
 * what is below it, as `redactTreeForSeat` decides: one the seat cannot see,
 * or a zone whose contents it cannot see. Walks `_t.parent`, marking nothing reached.
 */
export function outermostConcealer(element: GameElement, position: number): GameElement | undefined {
  const ancestors: GameElement[] = [];
  for (let ancestor = element._t.parent; ancestor; ancestor = ancestor._t.parent) ancestors.unshift(ancestor);
  return ancestors.find((ancestor) => {
    // Searched outermost first, so every ancestor above this one is visible (#1123).
    if (!ownVisibilityAllows(ancestor, position)) return true;
    const zone = hasZoneVisibility(ancestor) ? ancestor.getZoneVisibility() : undefined;
    return zone !== undefined && !canPlayerSee(zone, position, ancestor.getEffectiveOwner()?.seat);
  });
}
