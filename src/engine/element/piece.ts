import { GameElement } from './game-element.js';
import { Space } from './space.js';
import type { ElementClass, ElementAttributes, ElementContext } from './types.js';
import type { Player } from '../player/player.js';
import type { Game } from './game.js';

/**
 * Movable game element. Pieces represent items that can be relocated during play.
 *
 * Use Piece (or subclasses like Card, Die) for:
 * - Tokens and meeples
 * - Cards
 * - Dice
 * - Any component players can move around
 *
 * **Key features:**
 * - Movement: Relocate via `putInto(destination)`
 * - Removal: Remove from play via `remove()` (goes to game.pile)
 * - Visibility: element-level visibility is inherited from `GameElement`
 *   (`showToAll()`, `hideFromAll()`, `showOnlyTo()`, ...).
 *
 * @example
 * ```typescript
 * // Move a piece to a new location
 * piece.putInto(targetSpace);
 *
 * // Draw a card from deck to hand
 * const card = deck.first(Card);
 * card?.putInto(player.hand);
 *
 * // Remove a captured piece
 * capturedPiece.remove();
 *
 * // Show a card to specific player
 * card.showOnlyTo(player);
 * ```
 *
 * @typeParam G - The Game subclass type
 * @typeParam P - The Player subclass type
 */

/**
 * Is this element class `Space` itself, or a subclass of it?
 *
 * Written as a function so the identity comparison happens against a parameter
 * typed `ElementClass<GameElement>`, which `Space` satisfies outright. Compared
 * inline against `create`'s `ElementClass<T>` it needed a cast purely to make
 * the two sides comparable — a cast that also stopped checking that the left
 * side was an element class at all.
 */
function isSpaceClass(elementClass: ElementClass<GameElement>): boolean {
  return elementClass === Space || Object.prototype.isPrototypeOf.call(Space, elementClass);
}

export class Piece<G extends Game = any, P extends Player = any> extends GameElement<G, P> {
  constructor(ctx: Partial<ElementContext>) {
    super(ctx);
  }

  // ============================================
  // Movement
  // ============================================

  /**
   * Move this piece into another container.
   *
   * The piece is removed from its current parent and added to the destination.
   * Triggers `onExit` on the old parent and `onEnter` on the new parent.
   *
   * @param destination - The Space or Piece to move into
   * @param options.position - Where to insert: 'first' (top/front) or 'last' (bottom/back).
   *                           Default depends on destination's order mode.
   *
   * @example
   * ```typescript
   * // Move card to player's hand
   * card.putInto(player.hand);
   *
   * // Put on top of a stacking container (like a deck)
   * card.putInto(discardPile); // Goes on top due to 'stacking' order
   *
   * // Force position
   * card.putInto(deck, { position: 'last' }); // Bottom of deck
   * ```
   */
  putInto(destination: GameElement, options?: { position?: 'first' | 'last' }): void {
    this.moveToInternal(destination, options?.position);
  }

  // `moveToInternal` is inherited from `GameElement` (163-01/D22-D23 lift):
  // Piece no longer owns the splice+exit+enter+cycle-guard body — see
  // `GameElement.moveToInternal` for the (unchanged-in-ordering) logic,
  // now shared with `Space.reparent`/`remove`.

  /**
   * Remove this piece from play.
   *
   * The piece is moved to `game.pile`, a hidden container for removed elements.
   * Use this for captured pieces, discarded cards, or any element taken out of play.
   *
   * @example
   * ```typescript
   * // Remove a captured piece
   * capturedPiece.remove();
   *
   * // Remove all damage tokens from a unit
   * unit.all(DamageToken).forEach(t => t.remove());
   * ```
   */
  remove(): void {
    if (this.game.pile) {
      this.putInto(this.game.pile);
    }
  }

  // ============================================
  // Piece Restrictions
  // ============================================

  /**
   * Override create to prevent creating Spaces inside Pieces
   */
  override create<T extends GameElement>(
    elementClass: ElementClass<T>,
    name: string,
    attributes?: ElementAttributes<T>
  ): T {
    if (isSpaceClass(elementClass)) {
      throw new Error(`Cannot create Space "${name}" inside Piece "${this.name}"`);
    }
    return super.create(elementClass, name, attributes);
  }

  // ============================================
  // Type guard
  // ============================================

  /**
   * Check if this element is a Piece
   */
  isPiece(): boolean {
    return true;
  }
}
