import { GameElement } from '../element/game-element.js';
import { ElementCollection } from '../element/element-collection.js';
import type { Game } from '../element/game.js';
import type { ElementContext, ElementClass, ElementFinder, ElementJSON } from '../element/index.js';

/**
 * Base Player class. Extend this to add custom player properties.
 *
 * Players are now part of the game element tree and can be found via `game.all(Player)`.
 */
export class Player<G extends Game = any, P extends Player = any> extends GameElement<G, P> {
  /** Seat position (1-indexed: Player 1 = position 1) */
  position!: number;

  /** Player color (hex code) */
  color?: string;

  /** Whether this player is currently taking their turn */
  private _isCurrent: boolean = false;

  constructor(ctx: Partial<ElementContext>) {
    super(ctx);
  }

  /**
   * Check if this player is the first player (position 1)
   */
  get isFirstPlayer(): boolean {
    return this.position === 1;
  }

  /**
   * Check if this player is the current player
   */
  isCurrent(): boolean {
    return this._isCurrent;
  }

  /**
   * Set whether this player is current (called by game flow)
   */
  setCurrent(isCurrent: boolean): void {
    this._isCurrent = isCurrent;
  }

  /**
   * Find all elements owned by this player
   */
  allMy<T extends GameElement>(
    className: ElementClass<T>,
    ...finders: ElementFinder<T>[]
  ): ElementCollection<T> {
    return this.game.all(className, { player: this } as ElementFinder<T>, ...finders);
  }

  /**
   * Find the first element owned by this player
   */
  my<T extends GameElement>(
    className: ElementClass<T>,
    ...finders: ElementFinder<T>[]
  ): T | undefined {
    return this.game.first(className, { player: this } as ElementFinder<T>, ...finders);
  }

  /**
   * Check if this player has any matching elements (owned by this player)
   */
  hasElement<T extends GameElement>(
    className: ElementClass<T>,
    ...finders: ElementFinder<T>[]
  ): boolean {
    return this.my(className, ...finders) !== undefined;
  }

  /**
   * Serialize player to JSON
   */
  override toJSON(): ElementJSON {
    const json = super.toJSON();
    // Include _isCurrent in serialization
    if (this._isCurrent) {
      json.attributes._isCurrent = true;
    }
    return json;
  }

  static override unserializableAttributes = [
    ...GameElement.unserializableAttributes,
  ];
}
