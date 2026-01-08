import type { Game } from '../element/game.js';
import type { GameElement, ElementClass, ElementFinder } from '../element/index.js';
import { ElementCollection } from '../element/element-collection.js';

/**
 * Base Player class. Extend this to add custom player properties.
 */
export class Player<G extends Game = Game> {
  /** Immutable seat position (1-indexed: Player 1 = position 1) */
  readonly position: number;

  /** Player display name */
  name: string;

  /** Player color (hex code) */
  color?: string;

  /** Reference to the game */
  game!: G;

  /** Whether this player is currently taking their turn */
  private _isCurrent: boolean = false;

  constructor(position: number, name: string) {
    this.position = position;
    this.name = name;
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
    };
  }
}

/**
 * Collection of players with query and iteration methods.
 *
 * Player positions are 1-indexed: Player 1 has position 1, Player 2 has position 2, etc.
 * Use `players.get(1)` to get the first player.
 *
 * This class does NOT support array indexing (`players[0]`). Use explicit methods instead:
 * - `players.get(position)` - Get player by 1-indexed position
 * - `players.all()` - Get all players as array for iteration
 * - `players.forEach()`, `players.map()`, etc. - Iteration methods
 */
export class PlayerCollection<P extends Player = Player> {
  /** Internal 0-indexed storage (external API is 1-indexed) */
  #players: P[] = [];

  /** Index of the current player in internal array */
  #currentIndex: number = 0;

  /**
   * Add a player to the collection (internal use only)
   */
  add(player: P): void {
    this.#players.push(player);
  }

  /**
   * Get the number of players
   */
  get length(): number {
    return this.#players.length;
  }

  /**
   * Get all valid positions as an array [1, 2, 3, ...]
   */
  get positions(): number[] {
    return this.#players.map((_, i) => i + 1);
  }

  // ============================================
  // Access Methods (with validation)
  // ============================================

  /**
   * Get player by 1-indexed position.
   * Throws helpful error if position is invalid.
   *
   * @example
   * players.get(1) // First player
   * players.get(2) // Second player
   */
  get(position: number): P | undefined {
    this.#validatePosition(position);
    return this.#players[position - 1];
  }

  /**
   * Get player by 1-indexed position, throwing if not found.
   *
   * @example
   * players.getOrThrow(1) // First player, throws if doesn't exist
   */
  getOrThrow(position: number): P {
    const player = this.get(position);
    if (!player) {
      throw new Error(
        `No player at position ${position}. ` +
        `This game has ${this.length} players (positions 1 to ${this.length}).`
      );
    }
    return player;
  }

  /**
   * Validate a position and throw helpful error if invalid
   */
  #validatePosition(position: number): void {
    if (!Number.isInteger(position)) {
      throw new Error(
        `Invalid player position: ${position}. ` +
        `Position must be an integer.`
      );
    }
    if (position < 1) {
      throw new Error(
        `Invalid player position: ${position}. ` +
        `Player positions are 1-indexed (1 to ${this.length}). ` +
        `Use players.get(1) for the first player.`
      );
    }
    if (this.length > 0 && position > this.length) {
      throw new Error(
        `Invalid player position: ${position}. ` +
        `This game has ${this.length} players (positions 1 to ${this.length}).`
      );
    }
  }

  // ============================================
  // Iteration Methods
  // ============================================

  /**
   * Get all players as an array.
   * Use this for iteration when you need array methods.
   *
   * @example
   * for (const player of players.all()) { ... }
   * players.all().map(p => p.name)
   */
  all(): P[] {
    return [...this.#players];
  }

  /**
   * Execute a function for each player
   */
  forEach(fn: (player: P, index: number) => void): void {
    this.#players.forEach((player, index) => fn(player, index + 1));
  }

  /**
   * Map players to a new array
   */
  map<T>(fn: (player: P, position: number) => T): T[] {
    return this.#players.map((player, index) => fn(player, index + 1));
  }

  /**
   * Filter players
   */
  filter(fn: (player: P) => boolean): P[] {
    return this.#players.filter(fn);
  }

  /**
   * Find a player matching a condition
   */
  find(fn: (player: P) => boolean): P | undefined {
    return this.#players.find(fn);
  }

  /**
   * Check if any player matches a condition
   */
  some(fn: (player: P) => boolean): boolean {
    return this.#players.some(fn);
  }

  /**
   * Check if all players match a condition
   */
  every(fn: (player: P) => boolean): boolean {
    return this.#players.every(fn);
  }

  /**
   * Make PlayerCollection iterable
   */
  [Symbol.iterator](): Iterator<P> {
    return this.#players[Symbol.iterator]();
  }

  // ============================================
  // Current Player Management
  // ============================================

  /**
   * Get the current player
   */
  get current(): P | undefined {
    return this.#players[this.#currentIndex];
  }

  /**
   * Set the current player by player object or 1-indexed position.
   *
   * @example
   * players.setCurrent(1) // Set first player as current
   * players.setCurrent(somePlayer) // Set by player object
   */
  setCurrent(playerOrPosition: P | number): void {
    // Clear previous current
    const prevPlayer = this.#players[this.#currentIndex];
    if (prevPlayer) {
      prevPlayer.setCurrent(false);
    }

    // Calculate new index
    let newIndex: number;
    if (typeof playerOrPosition === 'number') {
      this.#validatePosition(playerOrPosition);
      newIndex = playerOrPosition - 1;
    } else {
      // Find player in collection
      const foundIndex = this.#players.findIndex(p => p === playerOrPosition);
      if (foundIndex === -1) {
        throw new Error(`Player not found in collection`);
      }
      newIndex = foundIndex;
    }

    this.#currentIndex = newIndex;

    // Set new current
    const newPlayer = this.#players[this.#currentIndex];
    if (newPlayer) {
      newPlayer.setCurrent(true);
    }
  }

  // ============================================
  // Turn Rotation (encapsulates modulo arithmetic)
  // ============================================

  /**
   * Get the next player after the current player (circular).
   * Player 4 → Player 1 in a 4-player game.
   */
  next(): P {
    const nextIndex = (this.#currentIndex + 1) % this.length;
    return this.#players[nextIndex];
  }

  /**
   * Get the previous player before the current player (circular).
   * Player 1 → Player 4 in a 4-player game.
   */
  previous(): P {
    const prevIndex = (this.#currentIndex - 1 + this.length) % this.length;
    return this.#players[prevIndex];
  }

  /**
   * Get the next player after a specific player (circular).
   *
   * @example
   * players.nextAfter(player4) // Returns player 1 in a 4-player game
   */
  nextAfter(player: P): P {
    const index = this.#players.findIndex(p => p === player);
    if (index === -1) {
      throw new Error(`Player not found in collection`);
    }
    const nextIndex = (index + 1) % this.length;
    return this.#players[nextIndex];
  }

  /**
   * Get the previous player before a specific player (circular).
   *
   * @example
   * players.previousBefore(player1) // Returns player 4 in a 4-player game
   */
  previousBefore(player: P): P {
    const index = this.#players.findIndex(p => p === player);
    if (index === -1) {
      throw new Error(`Player not found in collection`);
    }
    const prevIndex = (index - 1 + this.length) % this.length;
    return this.#players[prevIndex];
  }

  /**
   * Get all players in order, starting from a specific player.
   * Useful for turn order that starts from a specific position.
   *
   * @example
   * // In a 4-player game, starting from player 2:
   * players.rotateFrom(player2) // [player2, player3, player4, player1]
   */
  rotateFrom(startPlayer: P): P[] {
    const startIndex = this.#players.findIndex(p => p === startPlayer);
    if (startIndex === -1) {
      throw new Error(`Player not found in collection`);
    }
    const result: P[] = [];
    for (let i = 0; i < this.length; i++) {
      result.push(this.#players[(startIndex + i) % this.length]);
    }
    return result;
  }

  /**
   * Get all players in order, starting from a specific 1-indexed position.
   *
   * @example
   * // In a 4-player game, starting from position 2:
   * players.inOrderFrom(2) // [player2, player3, player4, player1]
   */
  inOrderFrom(startPosition: number): P[] {
    this.#validatePosition(startPosition);
    const startIndex = startPosition - 1;
    const result: P[] = [];
    for (let i = 0; i < this.length; i++) {
      result.push(this.#players[(startIndex + i) % this.length]);
    }
    return result;
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get all players except the given player (or current player if not specified)
   */
  others(excluding?: P): P[] {
    const excludePlayer = excluding ?? this.current;
    return this.#players.filter(p => p !== excludePlayer);
  }

  /**
   * Serialize to JSON
   */
  toJSON(): Record<string, unknown>[] {
    return this.#players.map(p => {
      // Defensive check for when prototype chain is broken (bundler issues)
      if (typeof p.toJSON === 'function') {
        return p.toJSON();
      }
      // Fallback serialization
      return {
        position: p.position,
        name: p.name,
        color: p.color,
      };
    });
  }

  /**
   * Get the internal current index (for serialization only)
   * @internal
   */
  get _currentIndex(): number {
    return this.#currentIndex;
  }

  /**
   * Set the internal current index (for deserialization only)
   * @internal
   */
  set _currentIndex(index: number) {
    this.#currentIndex = index;
  }
}
