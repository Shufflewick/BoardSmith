import { GameElement } from '../element/game-element.js';
import { ElementCollection } from '../element/element-collection.js';
import type { Game } from '../element/game.js';
import type { ElementContext, ElementClass, ElementFinder, ElementJSON } from '../element/index.js';

/**
 * Base Player class representing a participant in the game.
 *
 * **Players are GameElements**: Players live in the game's element tree as direct children
 * of the Game. This means you can find players using standard element queries:
 *
 * ```typescript
 * // Find all players
 * const players = game.all(Player);
 *
 * // Find player by position
 * const player1 = game.first(Player, { position: 1 });
 *
 * // Find players meeting a condition
 * const richPlayers = game.all(Player, p => p.gold > 10);
 * ```
 *
 * **Helper methods**: For common operations, use Game's player helper methods which
 * provide cleaner syntax: `game.currentPlayer`, `game.getPlayer(1)`, `game.nextPlayer()`.
 *
 * **Custom Player classes**: Extend Player to add game-specific properties:
 *
 * ```typescript
 * class MyPlayer extends Player<MyGame, MyPlayer> {
 *   gold: number = 0;
 *   health: number = 10;
 *   hand!: Hand;  // Player's hand of cards
 *
 *   // Add custom methods
 *   canAfford(cost: number): boolean {
 *     return this.gold >= cost;
 *   }
 * }
 *
 * // Register in your Game class
 * class MyGame extends Game<MyGame, MyPlayer> {
 *   static PlayerClass = MyPlayer;
 * }
 * ```
 *
 * **Ownership queries**: Use `allMy()`, `my()`, and `hasElement()` to find elements
 * owned by a player (elements with `player` property set to this player):
 *
 * ```typescript
 * // Find all cards owned by this player
 * const myCards = player.allMy(Card);
 *
 * // Find first equipment owned by player
 * const weapon = player.my(Equipment, { type: 'weapon' });
 *
 * // Check if player owns any gold tokens
 * if (player.hasElement(GoldToken)) { ... }
 * ```
 *
 * **Anti-patterns to avoid:**
 *
 * - **Don't duplicate player data in elements**: Store player-specific data ON the player,
 *   not redundantly on owned elements. Find the player via the tree when you need their data.
 *
 * - **Don't use fallbacks when player not found**: If `game.getPlayer(pos)` returns undefined,
 *   that's a bug - fix it rather than falling back to a default. Use `getPlayerOrThrow()` in
 *   action handlers where the player must exist.
 *
 * - **Don't cache player references**: Players may be recreated during state restoration.
 *   Always query for players fresh when needed, or use position numbers as stable identifiers.
 *
 * @typeParam G - The Game subclass type
 * @typeParam P - The Player subclass type (for type-safe player references)
 *
 * @see {@link Game.getPlayer} - Get player by position
 * @see {@link Game.currentPlayer} - Get current player
 * @see {@link Game.all} - Query players with `game.all(Player, ...)`
 */
export class Player<G extends Game = any, P extends Player = any> extends GameElement<G, P> {
  /**
   * System property to identify this element type for reliable detection.
   * $ prefix indicates this is a system property.
   * @internal
   */
  $type: 'player' = 'player';

  /**
   * Seat position (1-indexed: Player 1 = position 1, Player 2 = position 2, etc.).
   *
   * Position is assigned at game creation and remains constant throughout the game.
   * Use position as a stable identifier when you need to reference players across
   * state serialization/deserialization.
   *
   * @example
   * ```typescript
   * // Position is 1-indexed
   * const player1 = game.getPlayer(1); // First player
   * const player2 = game.getPlayer(2); // Second player
   *
   * // Use in turn order logic
   * const nextPosition = (current.position % playerCount) + 1;
   * ```
   */
  position!: number;

  /**
   * Player color for UI display (hex code like '#FF0000' or color name).
   *
   * Set during game setup and used by the UI to distinguish players visually.
   *
   * @example
   * ```typescript
   * // Set colors during setup
   * for (const player of game.all(Player)) {
   *   player.color = PLAYER_COLORS[player.position - 1];
   * }
   * ```
   */
  color?: string;

  /**
   * Whether this player is currently taking their turn.
   * @internal Use {@link isCurrent} and {@link setCurrent} instead.
   */
  private _isCurrent: boolean = false;

  constructor(ctx: Partial<ElementContext>) {
    super(ctx);
  }

  /**
   * Check if this player is the first player (position 1).
   *
   * Useful for determining starting player or special first-player rules.
   *
   * @example
   * ```typescript
   * if (player.isFirstPlayer) {
   *   // First player gets a bonus
   *   player.gold += 1;
   * }
   * ```
   */
  get isFirstPlayer(): boolean {
    return this.position === 1;
  }

  /**
   * Check if this player is the current player (whose turn it is).
   *
   * The current player is tracked via the `_isCurrent` internal flag, which is
   * managed by the game flow and `setCurrentPlayer()`.
   *
   * @returns `true` if this player is currently taking their turn
   *
   * @example
   * ```typescript
   * // In an action condition
   * action('playCard')
   *   .condition(ctx => ctx.player.isCurrent())
   *   .do(() => { ... })
   *
   * // Find the current player
   * const current = game.first(Player, p => p.isCurrent());
   * // Or use the helper: game.currentPlayer
   * ```
   *
   * @see {@link Game.currentPlayer} - Preferred way to get current player
   */
  isCurrent(): boolean {
    return this._isCurrent;
  }

  /**
   * Set whether this player is the current player.
   *
   * **Note**: Prefer using `game.setCurrentPlayer(player)` which handles clearing
   * the previous current player automatically.
   *
   * @param isCurrent - Whether this player should be current
   *
   * @example
   * ```typescript
   * // Usually called via game.setCurrentPlayer() instead
   * game.setCurrentPlayer(player);
   *
   * // Direct usage (must clear previous manually)
   * previousPlayer.setCurrent(false);
   * nextPlayer.setCurrent(true);
   * ```
   *
   * @see {@link Game.setCurrentPlayer} - Preferred method for changing current player
   */
  setCurrent(isCurrent: boolean): void {
    this._isCurrent = isCurrent;
  }

  /**
   * Find all elements in the game owned by this player.
   *
   * Searches the entire game tree for elements with `player` property set to this player.
   * This is a convenience method equivalent to `game.all(Class, { player: this })`.
   *
   * @param className - Element class to search for
   * @param finders - Additional filters (attribute objects or predicate functions)
   * @returns Collection of matching elements owned by this player
   *
   * @example
   * ```typescript
   * // Find all cards owned by this player
   * const myCards = player.allMy(Card);
   *
   * // Find player's red cards
   * const myRedCards = player.allMy(Card, { color: 'red' });
   *
   * // Find player's playable cards
   * const playableCards = player.allMy(Card, c => c.cost <= player.mana);
   *
   * // Count player's pieces on the board
   * const pieceCount = player.allMy(Piece).length;
   * ```
   *
   * @see {@link my} - Find first matching element
   * @see {@link hasElement} - Check if any matching elements exist
   */
  allMy<T extends GameElement>(
    className: ElementClass<T>,
    ...finders: ElementFinder<T>[]
  ): ElementCollection<T> {
    return this.game.all(className, { player: this } as ElementFinder<T>, ...finders);
  }

  /**
   * Find the first element in the game owned by this player.
   *
   * Searches the entire game tree for the first element with `player` property
   * set to this player. Returns `undefined` if no matching element found.
   *
   * @param className - Element class to search for
   * @param finders - Additional filters (attribute objects or predicate functions)
   * @returns First matching element, or `undefined`
   *
   * @example
   * ```typescript
   * // Find player's weapon
   * const weapon = player.my(Equipment, { slot: 'weapon' });
   *
   * // Find player's first piece
   * const piece = player.my(Piece);
   *
   * // Find player's strongest card
   * const strongest = player.my(Card, c => c.power >= 5);
   * ```
   *
   * @see {@link allMy} - Find all matching elements
   * @see {@link hasElement} - Check existence without retrieving
   */
  my<T extends GameElement>(
    className: ElementClass<T>,
    ...finders: ElementFinder<T>[]
  ): T | undefined {
    return this.game.first(className, { player: this } as ElementFinder<T>, ...finders);
  }

  /**
   * Check if this player owns any matching elements.
   *
   * More efficient than `allMy().length > 0` because it stops at the first match.
   *
   * @param className - Element class to search for
   * @param finders - Additional filters (attribute objects or predicate functions)
   * @returns `true` if at least one matching element is owned by this player
   *
   * @example
   * ```typescript
   * // Check if player has any cards
   * if (player.hasElement(Card)) {
   *   // Player can play a card
   * }
   *
   * // Check if player has a specific type of card
   * if (player.hasElement(Card, { type: 'attack' })) {
   *   // Player can attack
   * }
   *
   * // Use in action conditions
   * action('playCard')
   *   .condition(ctx => ctx.player.hasElement(Card))
   *   .do(() => { ... })
   * ```
   *
   * @see {@link my} - Get the actual element
   * @see {@link allMy} - Get all matching elements
   */
  hasElement<T extends GameElement>(
    className: ElementClass<T>,
    ...finders: ElementFinder<T>[]
  ): boolean {
    return this.my(className, ...finders) !== undefined;
  }

  /**
   * Serialize player to JSON for state persistence.
   *
   * Includes the `_isCurrent` flag in attributes when true, so current player
   * state is preserved across serialization/deserialization.
   *
   * @returns JSON representation of this player
   * @internal
   */
  override toJSON(): ElementJSON {
    const json = super.toJSON();
    // Include _isCurrent in serialization
    if (this._isCurrent) {
      json.attributes._isCurrent = true;
    }
    return json;
  }

  /** @internal */
  static override unserializableAttributes = [
    ...GameElement.unserializableAttributes,
  ];
}
