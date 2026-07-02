/**
 * Hidden-info visibility utilities for testing BoardSmith games (VIS-01).
 *
 * Provides `isElementVisible` and `getVisibleElements` — visibility predicates
 * derived from the SAME serialization path the wire uses
 * (`Game.toJSONForPlayer(seat)`), so tests never drift from what a seat's
 * client actually receives.
 *
 * @module
 */

import { GameElement, ElementCollection, type Game, type ElementJSON } from '../engine/index.js';

/**
 * Walk a serialized ElementJSON tree collecting the ids of nodes that are
 * present AND not flagged `__hidden`.
 *
 * Synthetic negative ids (used for zone-hidden/count-only children) are
 * always `__hidden`, so they never contribute to the visible-id set and can
 * never be reverse-mapped to a live element (there is no element with a
 * negative id).
 */
function collectVisibleIds(node: ElementJSON, into: Set<number>): void {
  const hidden = node.attributes?.__hidden === true;
  if (!hidden) {
    into.add(node.id);
  }
  if (node.children) {
    for (const child of node.children) {
      collectVisibleIds(child, into);
    }
  }
}

/**
 * Find the node for a given real element id within a serialized ElementJSON
 * tree (depth-first). Returns `undefined` if the element is absent from the
 * final tree (e.g. inside a zone-hidden/count-only collection, where children
 * are replaced by anonymized placeholders with synthetic negative ids).
 */
function findNodeById(node: ElementJSON, id: number): ElementJSON | undefined {
  if (node.id === id) return node;
  if (!node.children) return undefined;
  for (const child of node.children) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Is `element` visible to `seat` — judged on the EXACT final per-seat wire
 * output, not just the per-element visibility rule.
 *
 * **What NOT to do:** Do not call `element.isVisibleTo(seat)` directly in
 * test code to decide "is this safe to assert on" — that only reflects the
 * per-element/zone visibility filter. A game's `static playerView` hook runs
 * AFTER that filter (see `Game.toJSONForPlayer`, game.ts:2813-2816) and can
 * strip additional content from the final tree. `isElementVisible` accounts
 * for both stages by deriving its verdict from `game.toJSONForPlayer(seat)`
 * itself — the same bytes a real client receives.
 *
 * Three-state model: a node that is present and not `__hidden` is *visible*
 * (true); a node that is present but flagged `__hidden`, or a node that is
 * entirely absent from the final tree, is *not visible* (false).
 *
 * @param element - The live element to check
 * @param seat - The seat to check visibility for (use 0 for spectator)
 * @returns Whether `element`'s identity is visible to `seat` in the final tree
 */
export function isElementVisible(element: GameElement, seat: number): boolean {
  const game = element.game as Game;
  const GameClass = game.constructor as typeof Game;

  // FAST PATH: with no static playerView, toJSONForPlayer's output is exactly
  // the per-element isVisibleTo filter (game.ts:2813-2816 never runs), so
  // isVisibleTo alone provably matches the final tree.
  if (!GameClass.playerView) {
    return element.isVisibleTo(seat);
  }

  // FINAL-TREE PATH: a static playerView hook may strip content AFTER the
  // isVisibleTo filter, so judge visibility on the actual serialized output.
  const finalTree = game.toJSONForPlayer(seat);
  const node = findNodeById(finalTree, element.id);
  if (!node) return false; // absent from final tree
  return node.attributes?.__hidden !== true;
}

/**
 * Get the live elements visible to `seat` — derived from the final per-seat
 * serialized tree, matching `game.toJSONForPlayer(seat)` exactly.
 *
 * **What NOT to do:** Do not hand-parse `game.toJSONForPlayer(seat)` yourself
 * to figure out which elements are visible — this function does that for you
 * and reverse-maps the surviving node ids back to live elements so you can
 * keep using the normal element/collection API (`.filter()`, `.length`, etc.)
 * on the result.
 *
 * @param game - The game instance
 * @param seat - The seat to compute visibility for (use 0 for spectator)
 * @returns An ElementCollection of the live elements visible to `seat`
 */
export function getVisibleElements(game: Game, seat: number): ElementCollection<GameElement> {
  const GameClass = game.constructor as typeof Game;

  // FAST PATH: see isElementVisible for why this is safe when playerView is undefined.
  if (!GameClass.playerView) {
    return game.all(GameElement).filter((e) => e.isVisibleTo(seat));
  }

  // FINAL-TREE PATH: collect the visible ids from the actual serialized output,
  // then reverse-map by real (positive) element id back to live elements.
  const finalTree = game.toJSONForPlayer(seat);
  const visibleIds = new Set<number>();
  collectVisibleIds(finalTree, visibleIds);
  return game.all(GameElement).filter((e) => visibleIds.has(e.id));
}
