/**
 * Hidden-info visibility utilities for testing BoardSmith games (VIS-01).
 *
 * Provides `isElementVisible`, a visibility predicate derived from the SAME
 * serialization path the wire uses (`Game.toJSONForPlayer(seat)`), so tests
 * never drift from what a seat's client actually receives.
 *
 * @module
 */

import type { GameElement, ElementJSON } from '../engine/index.js';
import { isHiddenPlaceholder } from '../engine/element/hidden-placeholder.js';

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
 * test code to decide "is this safe to assert on" — it judges the engine's
 * visibility filter, not what is sent: a game's `static playerView` hook can
 * strip more after the filter. `isElementVisible` always derives its verdict
 * from `game.toJSONForPlayer(seat)` itself — the same bytes a real client
 * receives.
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
  const node = findNodeById(element.game.toJSONForPlayer(seat), element.id);
  return node !== undefined && !isHiddenPlaceholder(node);
}
