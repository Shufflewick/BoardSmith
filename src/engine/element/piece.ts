import { GameElement } from './game-element.js';
import { Space } from './space.js';
import type { ElementClass, ElementAttributes, ElementContext } from './types.js';
import type { Player } from '../player/player.js';
import type { Game } from './game.js';
import type { VisibilityMode } from '../command/visibility.js';
import { visibilityFromMode } from '../command/visibility.js';
import { devWarn, isDevMode } from '../../utils/dev.js';

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
 * - Visibility: Override zone visibility via `showToAll()`, `hideFromAll()`, etc.
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

  /**
   * Internal move method called by command executor
   */
  moveToInternal(destination: GameElement, position?: 'first' | 'last'): void {
    // ENG-01 (phase 132), ALL modes: reject a move onto this element's own
    // descendant (or itself). Unlike WR-03 below (a dev-only diagnostic for
    // detached destinations), this is real production tree corruption: an
    // unconditional splice of `this` out of its current parent followed by
    // reassigning `this._t.parent = destination` would leave `this` as both
    // an ancestor and a descendant of `destination`, producing a detached
    // cycle. Must run BEFORE any mutation below, in every environment.
    if (destination === this) {
      throw new Error(
        `Cannot move "${this.name ?? this.constructor.name}" into itself ` +
        `(an element is trivially its own descendant). ` +
        `putInto() destination must not be the element being moved.`
      );
    }
    for (let el: GameElement | undefined = destination._t.parent; el; el = el._t.parent) {
      if (el === this) {
        throw new Error(
          `Cannot move "${this.name ?? this.constructor.name}" into its own descendant ` +
          `"${destination.name ?? destination.constructor.name}". This would create a ` +
          `detached cycle in the element tree.`
        );
      }
    }

    // WR-03 (phase 131), DEV-only: detect a move into a DETACHED tree. The
    // classic cause is a restored onEnter/onExit handler whose closure
    // captured a constructor-local element (`const scorePile = this.create(...)`):
    // after a snapshot restore the closure still points at the DISCARDED
    // pre-restore tree, so the moved element silently vanishes from the
    // serialized game with no error. A detached destination has an ancestor
    // whose recorded parent no longer contains it (the restore rebuilt the
    // parent's children). `game.pile` is exempt by construction (no parent).
    if (isDevMode()) {
      for (let el: GameElement = destination; el._t.parent; el = el._t.parent) {
        if (!el._t.parent._t.children.includes(el)) {
          devWarn(
            `detached-destination:${destination.name ?? destination.constructor.name}`,
            `putInto() destination "${destination.name ?? destination.constructor.name}" is detached ` +
            `from the live element tree — the moved element will NOT appear in the serialized game. ` +
            `This usually means a restored onEnter/onExit handler is holding a stale reference to an ` +
            `element from before a snapshot restore. Handlers must reach elements via game attributes ` +
            `(this.scorePile) or queries (element.game.first(...)), never via captured local variables.`
          );
          break;
        }
      }
    }

    const oldParent = this._t.parent;

    // Remove from current parent
    if (oldParent) {
      const index = oldParent._t.children.indexOf(this);
      if (index !== -1) {
        oldParent._t.children.splice(index, 1);
      } else if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        // DEV: Element has a parent reference but isn't in parent's children array
        // This indicates tree corruption - element may end up in multiple places
        console.error(
          `[BoardSmith] 🚨 TREE CORRUPTION in moveToInternal:\n` +
          `  Element ${this.name ?? this.constructor.name} (id: ${this.id}) has parent reference to\n` +
          `  "${oldParent.name ?? oldParent.constructor.name}" (id: ${oldParent.id})\n` +
          `  but was NOT found in parent's children array!\n` +
          `  This element will now exist in multiple places in the tree.`
        );
      }

      // Trigger exit event if parent is a Space
      if (oldParent instanceof Space) {
        oldParent.triggerEvent('exit', this);
      }
    }

    // Add to new parent
    this._t.parent = destination;

    const pos = position ?? (destination._t.order === 'stacking' ? 'first' : 'last');
    if (pos === 'first') {
      destination._t.children.unshift(this);
    } else {
      destination._t.children.push(this);
    }

    // Trigger enter event if moving to a Space
    if (destination instanceof Space) {
      destination.triggerEvent('enter', this);
    }
  }

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
  // Visibility Control (explicit overrides of zone default)
  // ============================================

  /**
   * Explicitly set this piece's visibility (overrides zone default)
   */
  setVisibility(mode: VisibilityMode): void {
    this._visibility = visibilityFromMode(mode);
  }

  /**
   * Make this piece visible to all (overrides zone default)
   */
  showToAll(): void {
    this.setVisibility('all');
  }

  /**
   * Make this piece visible only to owner (overrides zone default)
   */
  showToOwner(): void {
    this.setVisibility('owner');
  }

  /**
   * Hide this piece from all (overrides zone default)
   */
  hideFromAll(): void {
    this.setVisibility('hidden');
  }

  /**
   * Add specific players who can see this piece (beyond inherited visibility)
   */
  addVisibleTo(...players: (Player | number)[]): void {
    const positions = players.map((p) => (typeof p === 'number' ? p : p.seat));
    this.addVisibleToInternal(positions);
  }

  /**
   * Show this piece only to a specific player (hide from all others)
   */
  showOnlyTo(player: Player | number): void {
    const seat = typeof player === 'number' ? player : player.seat;
    this._visibility = {
      mode: 'hidden',
      addPlayers: [seat],
      explicit: true,
    };
  }

  /**
   * Hide this piece from specific players (visible to all others)
   */
  hideFrom(...players: (Player | number)[]): void {
    const positions = players.map((p) => (typeof p === 'number' ? p : p.seat));
    this._visibility = {
      mode: 'all',
      exceptPlayers: positions,
      explicit: true,
    };
  }

  /**
   * Clear explicit visibility, reverting to inherited zone visibility
   */
  clearVisibility(): void {
    this._visibility = undefined;
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
    if (elementClass === Space as unknown as ElementClass<T> ||
        Object.prototype.isPrototypeOf.call(Space, elementClass)) {
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
