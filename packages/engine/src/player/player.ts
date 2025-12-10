import type { Game } from '../element/game.js';
import type { GameElement, ElementClass, ElementFinder } from '../element/index.js';
import { ElementCollection } from '../element/element-collection.js';

/**
 * Base Player class. Extend this to add custom player properties.
 */
export class Player<G extends Game = Game> {
  /** Immutable seat position (0-indexed) */
  readonly position: number;

  /** Player display name */
  name: string;

  /** Player color (hex code) */
  color?: string;

  /** Player avatar URL */
  avatar?: string;

  /** Reference to the game */
  game!: G;

  /** Whether this player is currently taking their turn */
  private _isCurrent: boolean = false;

  /** Attributes hidden from other players */
  static hiddenAttributes: string[] = [];

  constructor(position: number, name: string) {
    this.position = position;
    this.name = name;
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
   * Check if this player has any matching elements
   */
  has<T extends GameElement>(
    className: ElementClass<T>,
    ...finders: ElementFinder<T>[]
  ): boolean {
    return this.my(className, ...finders) !== undefined;
  }

  /**
   * Get string representation
   */
  toString(): string {
    return this.name;
  }

  /**
   * Serialize player to JSON
   */
  toJSON(): Record<string, unknown> {
    return {
      position: this.position,
      name: this.name,
      color: this.color,
      avatar: this.avatar,
    };
  }
}

/**
 * Collection of players with query methods
 */
export class PlayerCollection<P extends Player = Player> extends Array<P> {
  /** Index of the current player */
  private _currentIndex: number = 0;

  /**
   * Get the current player
   */
  get current(): P | undefined {
    return this[this._currentIndex];
  }

  /**
   * Set the current player
   */
  setCurrent(player: P | number): void {
    const index = typeof player === 'number' ? player : player.position;

    // Clear previous current
    if (this[this._currentIndex]) {
      this[this._currentIndex].setCurrent(false);
    }

    this._currentIndex = index;

    // Set new current
    if (this[this._currentIndex]) {
      this[this._currentIndex].setCurrent(true);
    }
  }

  /**
   * Get the next player in turn order
   */
  next(from?: P): P {
    const currentPos = from?.position ?? this._currentIndex;
    const nextPos = (currentPos + 1) % this.length;
    return this[nextPos];
  }

  /**
   * Get the previous player in turn order
   */
  previous(from?: P): P {
    const currentPos = from?.position ?? this._currentIndex;
    const prevPos = (currentPos - 1 + this.length) % this.length;
    return this[prevPos];
  }

  /**
   * Get all other players (excluding the given player or current player)
   */
  others(excluding?: P): PlayerCollection<P> {
    const excludePos = excluding?.position ?? this._currentIndex;
    const result = new PlayerCollection<P>();
    for (const player of this) {
      if (player.position !== excludePos) {
        result.push(player);
      }
    }
    return result;
  }

  /**
   * Get the other player (for 2-player games)
   */
  other(from?: P): P | undefined {
    if (this.length !== 2) {
      throw new Error('other() can only be used in 2-player games');
    }
    const fromPos = from?.position ?? this._currentIndex;
    return this.find(p => p.position !== fromPos);
  }

  /**
   * Find a player by position
   */
  byPosition(position: number): P | undefined {
    return this.find(p => p.position === position);
  }

  /**
   * Get players in turn order starting from a given player
   */
  inOrderFrom(startPlayer: P): PlayerCollection<P> {
    const result = new PlayerCollection<P>();
    const startIndex = startPlayer.position;

    for (let i = 0; i < this.length; i++) {
      const index = (startIndex + i) % this.length;
      result.push(this[index]);
    }

    return result;
  }

  /**
   * Serialize to JSON
   */
  toJSON(): Record<string, unknown>[] {
    return this.map(p => {
      // Defensive check for when prototype chain is broken (bundler issues)
      if (typeof p.toJSON === 'function') {
        return p.toJSON();
      }
      // Fallback serialization
      return {
        position: p.position,
        name: p.name,
        color: p.color,
        avatar: p.avatar,
      };
    });
  }
}
