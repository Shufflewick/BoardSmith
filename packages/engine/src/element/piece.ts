import { GameElement } from './game-element.js';
import { Space } from './space.js';
import type { ElementClass, ElementAttributes, ElementContext } from './types.js';
import type { Player } from '../player/player.js';
import type { Game } from './game.js';
import type { VisibilityMode } from '../command/visibility.js';
import { visibilityFromMode } from '../command/visibility.js';

/**
 * Pieces are game elements that can move during play.
 * Unlike Spaces, Pieces can be relocated between containers.
 *
 * Visibility: Pieces inherit visibility from their parent Space by default.
 * They can explicitly override this to be different from their zone.
 *
 * Examples: cards, tokens, meeples, dice
 */
export class Piece<G extends Game = any, P extends Player = any> extends GameElement<G, P> {
  constructor(ctx: Partial<ElementContext>) {
    super(ctx);
  }

  // ============================================
  // Movement
  // ============================================

  /**
   * Move this piece into another element (Space or Piece)
   */
  putInto(destination: GameElement, options?: { position?: 'first' | 'last' }): void {
    this.moveToInternal(destination, options?.position);
  }

  /**
   * Internal move method called by command executor
   */
  moveToInternal(destination: GameElement, position?: 'first' | 'last'): void {
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
   * Remove this piece from play (moves to game.pile)
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
    const positions = players.map((p) => (typeof p === 'number' ? p : p.position));
    this.addVisibleToInternal(positions);
  }

  /**
   * Show this piece only to a specific player (hide from all others)
   */
  showOnlyTo(player: Player | number): void {
    const position = typeof player === 'number' ? player : player.position;
    this._visibility = {
      mode: 'hidden',
      addPlayers: [position],
      explicit: true,
    };
  }

  /**
   * Hide this piece from specific players (visible to all others)
   */
  hideFrom(...players: (Player | number)[]): void {
    const positions = players.map((p) => (typeof p === 'number' ? p : p.position));
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
