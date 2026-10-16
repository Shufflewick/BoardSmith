/**
 * THE IDS A SEAT'S BOARD SHOWS IN PLACE OF REAL ONES (#715).
 *
 * A seat's view replaces the children of a zone it cannot see with
 * placeholders numbered -1, -2, ... in tree order (`Game.toJSONForPlayer`). A
 * pick that offers such an element must name it by that placeholder, so the
 * board can highlight it and the real id never leaves the server, and a
 * submitted placeholder must name the real element again
 * (`ActionExecutor.resolveOne`). Both directions read this map, off the seat's
 * own projection, the one source of those numbers.
 */
import type { Game } from './game.js';

/** Real id -> the placeholder id this seat's view gives it. */
export function placeholderIdsFor(game: Game, seat: number): Map<number, number> {
  const placeholders = new Map<number, number>();
  game.toJSONForPlayer(seat, placeholders);
  return placeholders;
}
