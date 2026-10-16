/**
 * ELEMENT REFERENCES IN ANIMATION DATA, AS ONE SEAT MAY READ THEM (#752).
 *
 * `toJSON` writes a reference as the element's true branch, once for every
 * seat. Inside something a seat cannot see, that branch gives away the
 * element's place (a shuffled deck's order, a hidden zone's size, a card's slot
 * in an opponent's hand), so the seat's copy names the outermost container that
 * conceals the element instead, the rule flow variables follow (#726). A
 * reference the seat can follow keeps its branch.
 */
import type { Game } from './game.js';
import { hasZoneVisibility, type GameElement } from './game-element.js';
import { canPlayerSee } from './visibility.js';

/** `value` with every `{ __elementRef }` in it rewritten for the seat at `position` (-1 for a spectator). */
export function concealRefsForSeat(value: unknown, game: Game, position: number): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => concealRefsForSeat(item, game, position));
  const branch = (value as { __elementRef?: unknown }).__elementRef;
  if (typeof branch === 'string') {
    const element = game.atBranch(branch);
    const concealer = element && outermostConcealer(element, position);
    return concealer ? { __elementRef: concealer.branch() } : value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, concealRefsForSeat(entry, game, position)]));
}

/**
 * The outermost ancestor whose view for this seat leaves out or anonymizes
 * what is below it, as `redactTreeForSeat` decides: one the seat cannot see,
 * or a zone whose contents it cannot see.
 */
function outermostConcealer(element: GameElement, position: number): GameElement | undefined {
  const ancestors: GameElement[] = [];
  for (let ancestor = element.parent; ancestor; ancestor = ancestor.parent) ancestors.unshift(ancestor);
  return ancestors.find((ancestor) => {
    if (!ancestor.isVisibleTo(position)) return true;
    const zone = hasZoneVisibility(ancestor) ? ancestor.getZoneVisibility() : undefined;
    return zone !== undefined && !canPlayerSee(zone, position, ancestor.getEffectiveOwner()?.seat);
  });
}
