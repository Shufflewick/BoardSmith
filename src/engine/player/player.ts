import { GameElement } from '../element/game-element.js';
import { ElementCollection } from '../element/element-collection.js';
import type { Game } from '../element/game.js';
import type { ElementContext, ElementClass, ElementFinder, ElementJSON } from '../element/index.js';

/**
 * Seat liveness, as the engine understands it.
 *
 * This is the ONLY seat-state vocabulary the engine acts on — `TurnOrder.ACTIVE_ONLY`
 * filters on it, and hosts/AI controllers can read it without knowing a game's rules.
 * Anything finer-grained (folded, stunned, passed-this-round) is game state and
 * belongs on your own `Player` subclass; do not overload these three.
 *
 * - `'active'` — a live participant. The default for every seat.
 * - `'dormant'` — temporarily not participating, but expected back: an unfilled
 *   pre-allocated seat, a character who has not arrived yet, a player on hold.
 * - `'eliminated'` — out of the game permanently.
 *
 * Both non-active states are skipped by {@link TurnOrder.ACTIVE_ONLY}; the
 * distinction is for the host and the UI, which treat "will return" and "gone"
 * differently.
 */
export type PlayerStatus = 'active' | 'dormant' | 'eliminated';

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
 * // Find player by seat
 * const player1 = game.first(Player, { seat: 1 });
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
 *   Always query for players fresh when needed, or use seat numbers as stable identifiers.
 *
 * @typeParam G - The Game subclass type
 * @typeParam P - The Player subclass type (for type-safe player references)
 *
 * @see {@link Game.getPlayer} - Get player by seat
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
   * Seat number (1-indexed: Player 1 = seat 1, Player 2 = seat 2, etc.).
   *
   * Seat is assigned at game creation and remains constant throughout the game.
   * Use seat as a stable identifier when you need to reference players across
   * state serialization/deserialization.
   *
   * @example
   * ```typescript
   * // Seat is 1-indexed
   * const player1 = game.getPlayer(1); // First player
   * const player2 = game.getPlayer(2); // Second player
   *
   * // Use in turn order logic
   * const nextSeat = (current.seat % playerCount) + 1;
   * ```
   */
  seat!: number;

  /**
   * Player color for UI display (hex code like '#FF0000' or color name).
   *
   * Set during game setup and used by the UI to distinguish players visually.
   *
   * @example
   * ```typescript
   * // Set colors during setup
   * for (const player of game.all(Player)) {
   *   player.color = PLAYER_COLORS[player.seat - 1];
   * }
   * ```
   */
  color?: string;

  /**
   * Human-readable name for {@link color} (e.g. "Red", "Blue").
   *
   * Auto-assigned from the game's labeled color palette (or the default palette
   * names) when players are created. Use this in player-facing text — logs,
   * narration — so messages read "Player 1 plays Red" instead of a raw hex.
   * Falls back to `undefined` only when the assigned hex has no known name.
   *
   * @example
   * ```typescript
   * this.message(`${player.name} plays ${player.colorLabel ?? player.color}`);
   * ```
   */
  colorLabel?: string;

  /**
   * Seat liveness — `'active'` (default), `'dormant'`, or `'eliminated'`.
   *
   * A first-class field, not a convention: `TurnOrder.ACTIVE_ONLY` filters on it,
   * it serializes with the rest of the tree, and it is visible to every seat
   * (who is still in the game is public information in every game that has the
   * concept). Set it directly from rule code:
   *
   * ```typescript
   * .execute((args, ctx) => {
   *   ctx.player.status = 'eliminated';
   * });
   *
   * eachPlayer({ ...TurnOrder.ACTIVE_ONLY, do: actionStep({ actions: ['play'] }) })
   * ```
   *
   * Keep game-specific seat conditions (folded, passed, stunned) on your own
   * `Player` subclass and filter with {@link TurnOrder.SKIP_IF} — this field is
   * the engine-wide vocabulary, deliberately narrow.
   *
   * @see {@link PlayerStatus}
   * @see {@link isActive}
   */
  status: PlayerStatus = 'active';

  /**
   * Whether this player is currently taking their turn.
   * @internal Use {@link isCurrent} and {@link setCurrent} instead.
   */
  private _isCurrent: boolean = false;

  constructor(ctx: Partial<ElementContext>) {
    super(ctx);
  }

  /**
   * Check if this player is the first player (seat 1).
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
    return this.seat === 1;
  }

  /**
   * Whether this seat is a live participant (`status === 'active'`).
   *
   * The positive form, so rule code reads as a rule rather than as a negated
   * enum comparison.
   *
   * @example
   * ```typescript
   * const survivors = game.all(Player, p => p.isActive);
   * if (survivors.length === 1) game.finish(survivors[0]);
   * ```
   */
  get isActive(): boolean {
    return this.status === 'active';
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
   * Action.create('playCard')
   *   .condition({ 'is your turn': ctx => ctx.player.isCurrent() })
   *   .execute(() => { ... })
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
   * Action.create('playCard')
   *   .condition({ 'has a card': ctx => ctx.player.hasElement(Card) })
   *   .execute(() => { ... })
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
