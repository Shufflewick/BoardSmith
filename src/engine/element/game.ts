import { Space } from './space.js';
import { GameElement } from './game-element.js';
import type { ElementContext, ElementClass, ElementJSON } from './types.js';
import { Player } from '../player/player.js';
import type { GameCommand, CommandResult } from '../command/types.js';
import { executeCommand, undoCommand } from '../command/executor.js';
import { createInverseCommand } from '../command/inverse.js';
import type { ActionDefinition, ActionResult, SerializedAction, ActionTrace, ActionDebugInfo, SelectionDebugInfo } from '../action/types.js';
import { ActionExecutor } from '../action/action.js';
import type { FlowDefinition, FlowState, FlowPosition } from '../flow/types.js';

/**
 * A Map-like structure that persists through HMR by syncing to game.settings.
 * Use game.persistentMap() to create instances.
 *
 * Limitations:
 * - Keys must be serializable to JSON (strings, numbers)
 * - Values must be serializable to JSON (no element references, functions, etc.)
 * - For element references, use element children instead
 */
export class PersistentMap<K, V> implements Map<K, V> {
  #game: Game;
  #key: string;

  constructor(game: Game, key: string) {
    this.#game = game;
    this.#key = key;
    // Initialize settings entry if not exists
    if (!(key in game.settings)) {
      game.settings[key] = {};
    }
  }

  #getData(): Record<string, V> {
    return (this.#game.settings[this.#key] as Record<string, V>) ?? {};
  }

  #setData(data: Record<string, V>): void {
    this.#game.settings[this.#key] = data;
  }

  get size(): number {
    return Object.keys(this.#getData()).length;
  }

  get(key: K): V | undefined {
    return this.#getData()[String(key)];
  }

  set(key: K, value: V): this {
    const data = this.#getData();
    data[String(key)] = value;
    this.#setData(data);
    return this;
  }

  has(key: K): boolean {
    return String(key) in this.#getData();
  }

  delete(key: K): boolean {
    const data = this.#getData();
    const existed = String(key) in data;
    delete data[String(key)];
    this.#setData(data);
    return existed;
  }

  clear(): void {
    this.#setData({});
  }

  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void {
    const data = this.#getData();
    for (const [k, v] of Object.entries(data)) {
      callbackfn.call(thisArg, v as V, k as unknown as K, this);
    }
  }

  *entries(): IterableIterator<[K, V]> {
    const data = this.#getData();
    for (const [k, v] of Object.entries(data)) {
      yield [k as unknown as K, v as V];
    }
  }

  *keys(): IterableIterator<K> {
    const data = this.#getData();
    for (const k of Object.keys(data)) {
      yield k as unknown as K;
    }
  }

  *values(): IterableIterator<V> {
    const data = this.#getData();
    for (const v of Object.values(data)) {
      yield v as V;
    }
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  get [Symbol.toStringTag](): string {
    return 'PersistentMap';
  }
}
import { FlowEngine } from '../flow/engine.js';

/**
 * Options for creating a new game
 */
export type GameOptions = {
  /** Number of players */
  playerCount: number;
  /** Player names (optional) */
  playerNames?: string[];
  /** Random seed for deterministic gameplay */
  seed?: string;
};

/**
 * Game phase
 */
export type GamePhase = 'setup' | 'started' | 'finished';

/**
 * Function to transform game state for a specific player's view.
 * Runs AFTER zone-based visibility filtering.
 * Use for attribute-level filtering that zone visibility can't handle.
 *
 * @param state - The zone-filtered state
 * @param playerPosition - The player position (null for spectators)
 * @param game - The game instance
 * @returns The transformed state
 */
export type PlayerViewFunction<G extends Game = Game> = (
  state: ElementJSON,
  playerPosition: number | null,
  game: G
) => ElementJSON;

/**
 * Seeded random number generator
 */
function createSeededRandom(seed: string): () => number {
  // Simple mulberry32 PRNG
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }

  return function () {
    h |= 0;
    h = h + 0x6D2B79F5 | 0;
    let t = Math.imul(h ^ h >>> 15, 1 | h);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Base Game class. The root of the element tree and container for all game state.
 *
 * Extend this class to create your game. The Game class serves as:
 * - **Element tree root**: All game elements (boards, cards, pieces) are children of Game
 * - **Action registry**: Define and register player actions via `registerActions()`
 * - **Flow controller**: Define game flow via `setFlow()` and `startFlow()`
 * - **Player manager**: Access players via `game.all(Player)` or helper methods
 * - **Message log**: Record game events via `message()`
 *
 * @example
 * ```typescript
 * class MyGame extends Game<MyGame, MyPlayer> {
 *   static PlayerClass = MyPlayer;  // Optional: custom Player type
 *
 *   board!: Board;
 *   deck!: Deck;
 *
 *   setup() {
 *     // Register element classes for serialization
 *     this.registerElements([Board, Deck, Card, Piece]);
 *
 *     // Create the game board and components
 *     this.board = this.create(Board, 'board');
 *     this.deck = this.create(Deck, 'deck');
 *
 *     // Create cards in the deck
 *     for (const cardData of CARD_DATA) {
 *       this.deck.create(Card, cardData.name, cardData);
 *     }
 *
 *     // Deal to players
 *     for (const player of this.all(Player)) {
 *       this.deck.dealTo(player.hand, 5);
 *     }
 *   }
 *
 *   defineActions() {
 *     // Define player actions
 *     this.registerActions(
 *       action('playCard')
 *         .chooseOnBoard('card', Card)
 *         .do(({ card }) => card.flip()),
 *       action('endTurn')
 *         .do(() => this.nextPlayer())
 *     );
 *   }
 *
 *   defineFlow() {
 *     // Define game flow
 *     this.setFlow(defineFlow({
 *       root: loop({
 *         while: () => !this.isFinished(),
 *         do: eachPlayer({
 *           do: actionStep({ actions: ['playCard', 'endTurn'] })
 *         })
 *       }),
 *       getWinners: () => [this.getHighestScoringPlayer()]
 *     }));
 *   }
 * }
 * ```
 *
 * @typeParam G - The concrete Game subclass type (for type-safe self-references)
 * @typeParam P - The Player subclass type used in this game
 */
export class Game<
  G extends Game = any,
  P extends Player = any
> extends Space<G, P> {
  /**
   * Optional function to transform state for each player's view.
   * Override in subclass for custom attribute-level filtering.
   */
  static playerView?: PlayerViewFunction;

  /**
   * Optional custom Player class to use when creating players.
   * Set this in subclasses that need custom Player types.
   * Using `any` to avoid TypeScript generic variance issues with subclass assignments.
   *
   * @example
   * ```typescript
   * class MyGame extends Game<MyGame, MyPlayer> {
   *   static PlayerClass = MyPlayer;
   * }
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static PlayerClass?: any;

  /** Container for removed elements */
  pile!: GameElement;

  /** Current game phase */
  phase: GamePhase = 'setup';

  /** Seeded random number generator */
  random: () => number;

  /** Message log */
  messages: Array<{ text: string; data?: Record<string, unknown> }> = [];

  /** Game settings */
  settings: Record<string, unknown> = {};

  /** Command history for event sourcing */
  commandHistory: GameCommand[] = [];

  /** Inverse command history for undo (parallel to commandHistory) */
  private _inverseHistory: (GameCommand | null)[] = [];

  /** Registered actions */
  private _actions: Map<string, ActionDefinition> = new Map();

  /** Action executor for validation and execution */
  private _actionExecutor!: ActionExecutor;

  /** Flow definition for this game */
  private _flowDefinition?: FlowDefinition;

  /** Flow engine instance */
  private _flowEngine?: FlowEngine;

  /** Debug registry for custom debug data (dev mode only) */
  private _debugRegistry: Map<string, () => unknown> = new Map();

  /** Persistent maps that survive HMR (synced to settings) */
  private _persistentMaps: Map<string, PersistentMap<unknown, unknown>> = new Map();

  /** Properties that are safe and shouldn't trigger HMR warnings */
  private static readonly _safeProperties = new Set([
    // Base GameElement properties
    '_t', '_ctx', 'game', 'name', 'player',
    // Game internal properties
    'pile', 'phase', 'random', 'messages', 'settings',
    'commandHistory', '_actions', '_actionExecutor', '_flowDefinition',
    '_flowEngine', '_debugRegistry', '_persistentMaps',
  ]);

  static override unserializableAttributes = [
    ...Space.unserializableAttributes,
    'pile',
    'random',
    'commandHistory',
    '_actions',
    '_actionExecutor',
    '_flowDefinition',
    '_flowEngine',
    '_debugRegistry',
  ];

  /**
   * Create a new game instance.
   *
   * @param options - Configuration for the new game
   * @param options.playerCount - Number of players (creates Player 1 through Player N)
   * @param options.playerNames - Optional custom names for players
   * @param options.seed - Optional random seed for deterministic gameplay (for replays/testing)
   *
   * @example
   * ```typescript
   * // Create a 4-player game
   * const game = new MyGame({ playerCount: 4 });
   *
   * // With custom names
   * const game = new MyGame({
   *   playerCount: 2,
   *   playerNames: ['Alice', 'Bob']
   * });
   *
   * // With seed for reproducible randomness
   * const game = new MyGame({
   *   playerCount: 4,
   *   seed: 'my-test-seed'
   * });
   * ```
   */
  constructor(options: GameOptions) {
    // Create seed for random
    const seed = options.seed ?? Math.random().toString(36).substring(2);
    const random = createSeededRandom(seed);

    // Initialize context with Map for class registry
    const ctx: Partial<ElementContext> = {
      sequence: 0,
      classRegistry: new Map(),
      random,
    };

    super(ctx);

    this.random = random;
    this.game = this as unknown as G;
    this._ctx.game = this;

    // Register base classes
    this._ctx.classRegistry.set('Space', Space as unknown as ElementClass);
    this._ctx.classRegistry.set('GameElement', GameElement as unknown as ElementClass);

    // Create removed elements pile
    this.pile = this.createElement(Space, '__pile__');
    this.pile._t.parent = undefined; // Remove from main tree

    // Store player config in settings for snapshot restoration
    this.settings.playerCount = options.playerCount;
    this.settings.playerNames = options.playerNames ?? Array.from(
      { length: options.playerCount },
      (_, i) => `Player ${i + 1}`
    );

    // Register Player class for serialization
    this._ctx.classRegistry.set('Player', Player as unknown as ElementClass);

    // Get the Player class to use (subclass may define a custom one)
    const PlayerClassToUse = (this.constructor as typeof Game).PlayerClass ?? Player;
    if (PlayerClassToUse !== Player) {
      // Register custom Player class for serialization
      this._ctx.classRegistry.set(PlayerClassToUse.name, PlayerClassToUse as unknown as ElementClass);
    }

    // Create players (1-indexed: Player 1 has position 1)
    for (let i = 0; i < options.playerCount; i++) {
      const playerName = options.playerNames?.[i] ?? `Player ${i + 1}`;
      const player = this.create(PlayerClassToUse as unknown as ElementClass<P>, playerName, { position: i + 1 } as any);
      if (i === 0) player.setCurrent(true);
    }

    // Initialize action executor
    this._actionExecutor = new ActionExecutor(this);

    // Schedule HMR warning check after subclass constructor completes
    // Uses queueMicrotask so it runs after the full constructor chain
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
      queueMicrotask(() => this._checkForVolatileState());
    }
  }

  /**
   * Check for Map/Array properties that won't survive HMR.
   * Runs after construction in development mode.
   */
  private _checkForVolatileState(): void {
    const warnings: string[] = [];
    const safeProps = (this.constructor as typeof Game)._safeProperties;

    for (const key of Object.keys(this)) {
      // Skip safe/internal properties
      if (safeProps.has(key)) continue;
      if (key.startsWith('_')) continue; // Private by convention

      const value = (this as Record<string, unknown>)[key];

      // Check for native Map (not PersistentMap)
      if (value instanceof Map && !(value instanceof PersistentMap)) {
        warnings.push(
          `  ⚠️  game.${key} is a Map - will be reset on HMR.\n` +
          `      Use: ${key} = this.persistentMap('${key}') for persistent state,\n` +
          `      or store data as element children.`
        );
      }

      // Check for native Set
      if (value instanceof Set) {
        warnings.push(
          `  ⚠️  game.${key} is a Set - will be reset on HMR.\n` +
          `      Consider using a PersistentMap or element children instead.`
        );
      }

      // Check for arrays that look like they hold state
      if (Array.isArray(value) && key !== 'messages') {
        warnings.push(
          `  ⚠️  game.${key} is an Array - will be reset on HMR.\n` +
          `      Consider storing items as element children instead,\n` +
          `      or use game.settings.${key} for simple data.`
        );
      }
    }

    // Also check Player instances
    for (const player of this.all(Player as unknown as ElementClass<P>)) {
      for (const key of Object.keys(player)) {
        if (key.startsWith('_')) continue;
        if (['position', 'name', 'game', 'score'].includes(key)) continue;

        const value = (player as Record<string, unknown>)[key];

        if (value instanceof Map) {
          warnings.push(
            `  ⚠️  player.${key} is a Map - will be reset on HMR.\n` +
            `      Consider using game.persistentMap() or element children.`
          );
        }

        if (Array.isArray(value) && value.length === 0) {
          // Only warn about arrays with initializers (empty on construction)
          // This catches patterns like: myItems: Item[] = []
          warnings.push(
            `  ⚠️  player.${key} is an Array - will be reset on HMR.\n` +
            `      Consider storing items as element children instead.`
          );
        }
      }
    }

    if (warnings.length > 0) {
      console.warn(
        '\n🔥 BoardSmith HMR Warning: Detected volatile state that won\'t survive hot reload:\n\n' +
        warnings.join('\n\n') +
        '\n\n  Learn more: https://boardsmith.dev/docs/hmr-state\n'
      );
    }
  }

  // ============================================
  // Persistent State (HMR-safe)
  // ============================================

  /**
   * Create a persistent Map that survives HMR (Hot Module Replacement).
   *
   * Unlike regular Maps, PersistentMaps store their data in game.settings,
   * so they're preserved when game rules are hot-reloaded during development.
   *
   * @param name - Unique name for this map (used as key in game.settings)
   * @returns A Map-like object that persists through HMR
   *
   * @example
   * ```typescript
   * // In your game class
   * pendingLoot = this.persistentMap<string, LootOption[]>('pendingLoot');
   *
   * // Use like a normal Map
   * this.pendingLoot.set(sectorId, options);
   * const options = this.pendingLoot.get(sectorId);
   * ```
   *
   * Limitations:
   * - Keys must be serializable (strings, numbers)
   * - Values must be JSON-serializable (no element references)
   * - For element references, use element children instead
   */
  protected persistentMap<K extends string | number, V>(name: string): PersistentMap<K, V> {
    // Return existing map if already created (for idempotency)
    if (this._persistentMaps.has(name)) {
      return this._persistentMaps.get(name) as PersistentMap<K, V>;
    }

    const map = new PersistentMap<K, V>(this, name);
    this._persistentMaps.set(name, map as PersistentMap<unknown, unknown>);
    return map;
  }

  /**
   * Register element classes for serialization/deserialization.
   * Call this in your game constructor before creating elements.
   *
   * @example
   * ```typescript
   * constructor(options: MyGameOptions) {
   *   super(options);
   *   this.registerElements([Card, Hand, Deck, DiscardPile]);
   *   // ... create elements
   * }
   * ```
   */
  protected registerElements(
    classes: (new (...args: any[]) => GameElement)[]
  ): void {
    for (const cls of classes) {
      const className = cls.name;
      if (!this._ctx.classRegistry.has(className)) {
        this._ctx.classRegistry.set(className, cls as ElementClass);
      }
    }
  }

  /**
   * Create an element without adding it to the tree (internal use)
   */
  protected createElement<T extends GameElement>(
    elementClass: ElementClass<T>,
    name: string
  ): T {
    const element = new elementClass(this._ctx);
    element.name = name;
    element.game = this as unknown as Game;

    const className = elementClass.name;
    if (!this._ctx.classRegistry.has(className)) {
      this._ctx.classRegistry.set(className, elementClass);
    }

    return element;
  }

  // ============================================
  // Element Lookup
  // ============================================

  /**
   * Find an element by its ID anywhere in the game tree
   */
  getElementById(id: number): GameElement | undefined {
    // Check main tree
    const found = this.atId(id);
    if (found) return found;

    // Check pile
    return this.pile.atId(id);
  }

  /**
   * Get an element class by name (for command execution)
   */
  getElementClass(className: string): ElementClass | undefined {
    return this._ctx.classRegistry.get(className);
  }

  // ============================================
  // Command Execution
  // ============================================

  /**
   * Execute a command and record it in history
   */
  execute(command: GameCommand): CommandResult {
    // Capture inverse BEFORE executing (needed for proper undo)
    const inverse = createInverseCommand(this, command);

    const result = executeCommand(this, command);
    if (result.success) {
      this.commandHistory.push(command);
      this._inverseHistory.push(inverse);
    }
    return result;
  }

  /**
   * Replay commands to rebuild state
   */
  replayCommands(commands: GameCommand[]): void {
    for (const command of commands) {
      const result = executeCommand(this, command);
      if (!result.success) {
        throw new Error(`Failed to replay command: ${result.error}`);
      }
      this.commandHistory.push(command);
      // Can't compute inverse during replay - set to null
      this._inverseHistory.push(null);
    }
  }

  /**
   * Undo the last command in history.
   * Returns false if history is empty or last command is not invertible.
   *
   * @internal Used by MCTS for efficient state rollback
   */
  undoLastCommand(): boolean {
    if (this.commandHistory.length === 0) return false;

    const lastInverse = this._inverseHistory[this._inverseHistory.length - 1];
    if (!lastInverse) {
      // Command not invertible
      return false;
    }

    const lastCommand = this.commandHistory[this.commandHistory.length - 1];
    const result = undoCommand(this, lastCommand, lastInverse);

    if (result.success) {
      this.commandHistory.pop();
      this._inverseHistory.pop();
    }

    return result.success;
  }

  /**
   * Undo multiple commands from history.
   * Stops and returns false if any command is not invertible.
   *
   * @internal Used by MCTS for efficient state rollback
   */
  undoCommands(count: number): boolean {
    for (let i = 0; i < count; i++) {
      if (!this.undoLastCommand()) return false;
    }
    return true;
  }

  // ============================================
  // Action System
  // ============================================

  /**
   * Register a single action definition.
   *
   * Prefer `registerActions()` for registering multiple actions at once.
   *
   * @param action - The action definition to register
   */
  registerAction(action: ActionDefinition): void {
    this._actions.set(action.name, action);
  }

  /**
   * Register multiple action definitions.
   *
   * Actions define what players can do during the game. Each action has a name,
   * optional selections (choices the player must make), and an effect.
   *
   * @param actions - Action definitions created with the `action()` builder
   *
   * @example
   * ```typescript
   * // In your game's defineActions() method
   * this.registerActions(
   *   action('drawCard')
   *     .do(() => this.deck.dealTo(ctx.player.hand, 1)),
   *
   *   action('playCard')
   *     .chooseOnBoard('card', Card, { from: () => ctx.player.hand })
   *     .chooseOnBoard('target', Space)
   *     .do(({ card, target }) => card.putInto(target)),
   *
   *   action('endTurn')
   *     .do(() => this.players.next())
   * );
   * ```
   */
  registerActions(...actions: ActionDefinition[]): void {
    for (const action of actions) {
      this.registerAction(action);
    }
  }

  /**
   * Get an action definition by name
   */
  getAction(name: string): ActionDefinition | undefined {
    return this._actions.get(name);
  }

  /**
   * Get all registered action names
   */
  getActionNames(): string[] {
    return [...this._actions.keys()];
  }

  /**
   * Get available actions for a player
   */
  getAvailableActions(player: P): ActionDefinition[] {
    const available: ActionDefinition[] = [];
    for (const action of this._actions.values()) {
      if (this._actionExecutor.isActionAvailable(action, player)) {
        available.push(action);
      }
    }
    return available;
  }

  /**
   * Get the action executor (for advanced usage like building action metadata)
   */
  getActionExecutor(): ActionExecutor {
    return this._actionExecutor;
  }

  /**
   * Get the choices for a selection (for UI)
   */
  getSelectionChoices(
    actionName: string,
    selectionName: string,
    player: P,
    args: Record<string, unknown> = {}
  ): unknown[] {
    const action = this._actions.get(actionName);
    if (!action) return [];

    const selection = action.selections.find(s => s.name === selectionName);
    if (!selection) return [];

    return this._actionExecutor.getChoices(selection, player, args);
  }

  /**
   * Perform an action with the given arguments
   */
  performAction(
    actionName: string,
    player: P,
    args: Record<string, unknown>
  ): ActionResult {
    const action = this._actions.get(actionName);
    if (!action) {
      return { success: false, error: `Unknown action: ${actionName}` };
    }

    return this._actionExecutor.executeAction(action, player, args);
  }

  /**
   * Perform an action from serialized form (for network play)
   */
  performSerializedAction(serialized: SerializedAction): ActionResult {
    const player = this.getPlayer(serialized.player);
    if (!player) {
      return { success: false, error: `Invalid player position: ${serialized.player}. Expected 1 to ${this.all(Player as unknown as ElementClass<P>).length}.` };
    }

    return this.performAction(serialized.name, player as P, serialized.args);
  }

  // ============================================
  // Debug API
  // ============================================

  /**
   * Register a custom debug entry.
   * The provided function will be called when debug data is requested.
   * Use this to expose game-specific debug information in the debug panel.
   *
   * @example
   * ```typescript
   * // In game setup
   * this.registerDebug('Sector Stashes', () =>
   *   this.all(Sector).map(s => ({
   *     name: s.sectorName,
   *     explored: s.explored,
   *     stash: s.stash.map(e => e.name)
   *   }))
   * );
   * ```
   */
  registerDebug(name: string, fn: () => unknown): void {
    this._debugRegistry.set(name, fn);
  }

  /**
   * Get all custom debug data.
   * Calls each registered debug function and collects the results.
   */
  getCustomDebugData(): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const [name, fn] of this._debugRegistry) {
      try {
        data[name] = fn();
      } catch (error) {
        data[name] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    return data;
  }

  /**
   * Get action availability traces for a player.
   * Returns detailed information about why each action is or isn't available.
   * Used by the debug interface to show action condition status.
   */
  getActionTraces(player: P): ActionTrace[] {
    const traces: ActionTrace[] = [];
    for (const action of this._actions.values()) {
      traces.push(this._actionExecutor.traceActionAvailability(action, player));
    }
    return traces;
  }

  /**
   * Debug why an action is or isn't available for a player.
   * Returns human-readable information explaining the availability status.
   *
   * This is the recommended method for debugging action availability issues.
   * It provides clear explanations rather than just raw trace data.
   *
   * @example
   * ```typescript
   * const debug = game.debugActionAvailability('equipItem', player);
   * console.log(debug.reason);
   * // "Selection 'equipment' has no valid choices"
   *
   * // For more detail:
   * for (const sel of debug.details.selections) {
   *   console.log(`${sel.name}: ${sel.choices} choices`);
   *   if (sel.note) console.log(`  └─ ${sel.note}`);
   * }
   * ```
   *
   * @param actionName - Name of the action to debug
   * @param player - Player to check availability for
   * @returns Human-readable debug information
   */
  debugActionAvailability(actionName: string, player: P): ActionDebugInfo {
    const action = this._actions.get(actionName);

    if (!action) {
      return {
        actionName,
        available: false,
        reason: `Action '${actionName}' does not exist`,
        details: {
          conditionPassed: false,
          conditionNote: `No action registered with name '${actionName}'. Check for typos or ensure the action is registered.`,
          selections: [],
        },
      };
    }

    const trace = this._actionExecutor.traceActionAvailability(action, player);
    return this._formatActionDebugInfo(trace);
  }

  /**
   * Debug all actions for a player.
   * Returns human-readable information for every registered action.
   *
   * @example
   * ```typescript
   * const allDebug = game.debugAllActions(player);
   * for (const debug of allDebug) {
   *   if (!debug.available) {
   *     console.log(`${debug.actionName}: ${debug.reason}`);
   *   }
   * }
   * ```
   */
  debugAllActions(player: P): ActionDebugInfo[] {
    return this.getActionTraces(player).map(trace => this._formatActionDebugInfo(trace));
  }

  /**
   * Debug element tree to diagnose element count issues.
   * Returns detailed information about the element tree structure.
   *
   * Use this when debugging issues like:
   * - Element count explosion (too many elements)
   * - Missing elements (elements not found)
   * - Tree corruption (circular references)
   *
   * @example
   * ```typescript
   * const treeInfo = game.debugElementTree();
   * console.log(treeInfo.summary);
   * // "Total: 205 elements in tree, 12 in pile, sequence at 217"
   *
   * console.log(treeInfo.byClass);
   * // { Equipment: 198, Sector: 5, Player: 2 }
   * ```
   */
  debugElementTree(): {
    /** Total elements in main game tree */
    totalInTree: number;
    /** Total elements in the pile (removed elements) */
    totalInPile: number;
    /** Element sequence counter (total elements ever created) */
    sequenceCounter: number;
    /** Element counts by class name */
    byClass: Record<string, number>;
    /** Max tree depth */
    maxDepth: number;
    /** Summary string */
    summary: string;
    /** Any integrity issues detected */
    issues: string[];
  } {
    const byClass: Record<string, number> = {};
    let maxDepth = 0;
    const issues: string[] = [];
    const seenIds = new Set<number>();
    const seenElements = new Set<GameElement>();

    const processElement = (el: GameElement, depth: number, expectedParent?: GameElement) => {
      // Check for circular reference (same element visited twice)
      if (seenElements.has(el)) {
        issues.push(`Circular reference detected: element ${el.name} (id: ${el.id}) visited twice`);
        return;
      }
      seenElements.add(el);

      // Check for duplicate IDs
      if (seenIds.has(el.id)) {
        issues.push(`Duplicate ID detected: ${el.id} (${el.name})`);
      }
      seenIds.add(el.id);

      // Check parent-child consistency
      if (expectedParent && el._t.parent !== expectedParent) {
        const actualParentName = el._t.parent?.name ?? el._t.parent?.constructor.name ?? 'undefined';
        const expectedParentName = expectedParent.name ?? expectedParent.constructor.name;
        issues.push(
          `Parent mismatch: ${el.name} (id: ${el.id}) is in ${expectedParentName}'s children ` +
          `but its _t.parent points to ${actualParentName} (id: ${el._t.parent?.id ?? 'none'})`
        );
      }

      // Count by class
      const className = el.constructor.name;
      byClass[className] = (byClass[className] || 0) + 1;

      // Track depth
      maxDepth = Math.max(maxDepth, depth);

      // Process children
      for (const child of el._t.children) {
        processElement(child, depth + 1, el);
      }
    };

    // Process main tree (starting from game's children, not game itself)
    for (const child of this._t.children) {
      processElement(child, 1, this);
    }

    const totalInTree = seenElements.size;

    // Reset for pile processing
    seenElements.clear();
    seenIds.clear();

    // Process pile
    for (const child of this.pile._t.children) {
      processElement(child, 1, this.pile);
    }

    const totalInPile = seenElements.size;
    const sequenceCounter = this._ctx.sequence;

    // Check if sequence is much higher than element count (suggests many deletions)
    if (sequenceCounter > totalInTree + totalInPile + 100) {
      issues.push(
        `Sequence counter (${sequenceCounter}) is much higher than total elements (${totalInTree + totalInPile}). ` +
        `This suggests many elements were created and removed, which is normal but could indicate unexpected element creation.`
      );
    }

    const summary = `Total: ${totalInTree} elements in tree, ${totalInPile} in pile, sequence at ${sequenceCounter}`;

    return {
      totalInTree,
      totalInPile,
      sequenceCounter,
      byClass,
      maxDepth,
      summary,
      issues,
    };
  }

  /**
   * Debug helper: Check if an element's parent-child relationships are consistent.
   * Use this to diagnose tree corruption issues.
   *
   * @example
   * ```typescript
   * const info = game.debugElement(suspiciousElement);
   * if (info.issues.length > 0) {
   *   console.error('Tree corruption:', info.issues);
   * }
   * ```
   *
   * @returns Object with validation results and any issues found
   */
  debugElement(element: GameElement): {
    id: number;
    name: string;
    parentId: number | undefined;
    parentName: string | undefined;
    childIds: number[];
    isInParentChildren: boolean;
    childrenPointToThis: boolean[];
    issues: string[];
  } {
    const issues: string[] = [];

    // Check if this element is in its parent's children
    const parent = element._t.parent;
    const isInParentChildren = parent
      ? parent._t.children.includes(element)
      : true; // No parent = OK

    if (parent && !isInParentChildren) {
      issues.push(
        `Element "${element.name}" (id: ${element.id}) has parent "${parent.name}" (id: ${parent.id}) ` +
        `but is NOT in parent's _t.children array`
      );
    }

    // Check if all children point back to this element
    const childrenPointToThis = element._t.children.map(child => child._t.parent === element);
    const wrongParentChildren = element._t.children.filter(child => child._t.parent !== element);
    for (const child of wrongParentChildren) {
      const actualParent = child._t.parent;
      issues.push(
        `Child "${child.name}" (id: ${child.id}) is in "${element.name}"'s children ` +
        `but _t.parent points to "${actualParent?.name}" (id: ${actualParent?.id ?? 'none'})`
      );
    }

    return {
      id: element.id,
      name: element.name ?? element.constructor.name,
      parentId: parent?.id,
      parentName: parent?.name ?? parent?.constructor.name,
      childIds: element._t.children.map(c => c.id),
      isInParentChildren,
      childrenPointToThis,
      issues,
    };
  }

  /**
   * Convert an ActionTrace to human-readable ActionDebugInfo
   */
  private _formatActionDebugInfo(trace: ActionTrace): ActionDebugInfo {
    const selections: SelectionDebugInfo[] = trace.selections.map(sel => {
      const passed = !!sel.optional || sel.choiceCount !== 0;
      let note: string | undefined;

      if (sel.choiceCount === -1) {
        note = 'Free input (text/number) - always available';
      } else if (sel.optional) {
        note = sel.choiceCount > 0
          ? `Optional with ${sel.choiceCount} choices`
          : 'Optional - can be skipped';
      } else if (sel.choiceCount === 0) {
        if (sel.dependentOn) {
          note = `Depends on '${sel.dependentOn}' - no valid combinations found`;
        } else if (sel.filterApplied) {
          note = 'Filter eliminated all choices';
        } else {
          note = 'No elements/choices available';
        }
      } else {
        note = `${sel.choiceCount} valid choice${sel.choiceCount === 1 ? '' : 's'}`;
      }

      return {
        name: sel.name,
        choices: sel.choiceCount,
        passed,
        note,
      };
    });

    // Determine the reason
    let reason: string;
    const conditionPassed = trace.conditionResult !== false;
    let conditionNote: string | undefined;

    if (trace.conditionError) {
      reason = `Condition threw an error: ${trace.conditionError}`;
      conditionNote = trace.conditionError;
    } else if (!conditionPassed) {
      // Build condition note from details if available
      if (trace.conditionDetails && trace.conditionDetails.length > 0) {
        const failedChecks = trace.conditionDetails.filter(d => !d.passed);
        if (failedChecks.length > 0) {
          conditionNote = failedChecks.map(d => `${d.label} = ${JSON.stringify(d.value)}`).join(', ');
          reason = `Condition failed: ${conditionNote}`;
        } else {
          reason = 'Condition returned false';
          conditionNote = 'Condition returned false (use object-based condition for details)';
        }
      } else {
        reason = 'Condition returned false';
        conditionNote = 'Condition returned false (use object-based condition for automatic tracing)';
      }
    } else if (!trace.available) {
      // Find the blocking selection
      const blockingSel = selections.find(s => !s.passed);
      if (blockingSel) {
        reason = `Selection '${blockingSel.name}' has no valid choices`;
        if (blockingSel.note) {
          reason += ` (${blockingSel.note})`;
        }
      } else {
        reason = 'No valid selection path found';
      }
    } else {
      // Action is available
      if (selections.length === 0) {
        reason = 'Action is available (no selections required)';
      } else {
        const firstSel = selections[0];
        reason = `Action is available with ${firstSel.choices} choice${firstSel.choices === 1 ? '' : 's'} for '${firstSel.name}'`;
      }
    }

    return {
      actionName: trace.actionName,
      available: trace.available,
      reason,
      details: {
        conditionPassed,
        conditionNote,
        selections,
      },
    };
  }

  // ============================================
  // Flow System
  // ============================================

  /**
   * Set the flow definition for this game.
   *
   * The flow defines the structure of your game: the order of turns,
   * phases, and when the game ends. Use the flow builder functions
   * (`defineFlow`, `loop`, `eachPlayer`, `actionStep`, etc.) to create
   * the flow definition.
   *
   * @param definition - Flow definition created with `defineFlow()`
   *
   * @example
   * ```typescript
   * // In your game's defineFlow() method
   * this.setFlow(defineFlow({
   *   root: loop({
   *     while: () => !this.isFinished(),
   *     do: eachPlayer({
   *       do: sequence(
   *         actionStep({ actions: ['draw'] }),
   *         actionStep({ actions: ['play', 'endTurn'] })
   *       )
   *     })
   *   }),
   *   isComplete: () => this.deck.isEmpty(),
   *   getWinners: () => [this.players.withHighestScore()]
   * }));
   * ```
   */
  setFlow(definition: FlowDefinition): void {
    this._flowDefinition = definition;
  }

  /**
   * Get the flow definition
   */
  getFlow(): FlowDefinition | undefined {
    return this._flowDefinition;
  }

  /**
   * Start the game flow
   */
  startFlow(): FlowState {
    if (!this._flowDefinition) {
      throw new Error('No flow definition set');
    }

    this._flowEngine = new FlowEngine(this, this._flowDefinition);
    const state = this._flowEngine.start();

    // Update game phase based on flow state
    if (this.phase === 'setup') {
      this.phase = 'started';
    }
    if (state.complete) {
      this.phase = 'finished';
    }

    return state;
  }

  /**
   * Resume flow after player action
   * @param actionName Action name to perform
   * @param args Action arguments
   * @param playerIndex Optional player index for simultaneous actions
   */
  continueFlow(actionName: string, args: Record<string, unknown>, playerIndex?: number): FlowState {
    if (!this._flowEngine) {
      throw new Error('Flow not started');
    }

    const state = this._flowEngine.resume(actionName, args, playerIndex);

    if (state.complete) {
      this.phase = 'finished';
      const winners = this._flowEngine.getWinners();
      if (winners.length > 0) {
        this.settings.winners = winners.map(p => p.position);
      }
    }

    return state;
  }

  /**
   * Continue flow after a pending action was executed externally.
   * Used when an action with repeating selections completes via the action executor.
   * @param result The result of the executed action
   */
  continueFlowAfterPendingAction(result: ActionResult): FlowState {
    if (!this._flowEngine) {
      throw new Error('Flow not started');
    }

    const state = this._flowEngine.resumeAfterExternalAction(result);

    if (state.complete) {
      this.phase = 'finished';
      const winners = this._flowEngine.getWinners();
      if (winners.length > 0) {
        this.settings.winners = winners.map(p => p.position);
      }
    }

    return state;
  }

  /**
   * Get current flow state
   */
  getFlowState(): FlowState | undefined {
    return this._flowEngine?.getState();
  }

  /**
   * Restore flow from serialized position.
   * Throws if the position is invalid (e.g., flow structure changed).
   */
  restoreFlow(position: FlowPosition): void {
    if (!this._flowDefinition) {
      throw new Error('No flow definition set');
    }

    this._flowEngine = new FlowEngine(this, this._flowDefinition);
    const result = this._flowEngine.tryRestore(position);

    if (!result.success) {
      throw new Error(
        `Flow position invalid: ${result.error}. ` +
        `Valid path prefix: [${result.validPath.join(', ')}]`
      );
    }
  }

  /**
   * Restore full flow state including awaiting state.
   * Used for HMR where we want to restore exactly where we were.
   * Throws if the position is invalid (e.g., flow structure changed).
   */
  restoreFlowState(state: FlowState): void {
    if (!this._flowDefinition) {
      throw new Error('No flow definition set');
    }

    this._flowEngine = new FlowEngine(this, this._flowDefinition);
    const result = this._flowEngine.restoreFullState(state);

    if (!result.success) {
      throw new Error(
        `Flow position invalid: ${result.error}. ` +
        `Valid path prefix: [${result.validPath.join(', ')}]`
      );
    }
  }

  /**
   * Check if flow is awaiting player input
   */
  isAwaitingInput(): boolean {
    return this._flowEngine?.getState().awaitingInput ?? false;
  }

  /**
   * Get current player from flow (if awaiting input)
   */
  getCurrentFlowPlayer(): P | undefined {
    const state = this._flowEngine?.getState();
    if (state?.currentPlayer !== undefined) {
      return this.getPlayer(state.currentPlayer);
    }
    return undefined;
  }

  /**
   * Get available actions from flow (if awaiting input)
   */
  getFlowAvailableActions(): string[] {
    return this._flowEngine?.getState().availableActions ?? [];
  }

  /**
   * Get awaiting players for simultaneous actions
   * Returns undefined if not in a simultaneous action step
   */
  getAwaitingPlayers(): { playerIndex: number; availableActions: string[]; completed: boolean }[] | undefined {
    const state = this._flowEngine?.getState();
    return state?.awaitingPlayers;
  }

  /**
   * Check if a player can act (either as current player or in simultaneous action)
   */
  canPlayerAct(playerIndex: number): boolean {
    const state = this._flowEngine?.getState();
    if (!state?.awaitingInput) return false;

    // Check for simultaneous action step
    if (state.awaitingPlayers && state.awaitingPlayers.length > 0) {
      const playerState = state.awaitingPlayers.find(p => p.playerIndex === playerIndex);
      return playerState ? !playerState.completed && playerState.availableActions.length > 0 : false;
    }

    // Check for regular single-player action step
    return state.currentPlayer === playerIndex;
  }

  // ============================================
  // Player Helpers
  // ============================================
  //
  // Players are direct children of the Game in the element tree. These helper
  // methods provide convenient access to players without requiring manual tree
  // queries. For complex player queries, use `game.all(Player, ...)` directly:
  //
  //   // Find players with more than 10 gold
  //   const richPlayers = game.all(Player, p => p.gold > 10);
  //
  //   // Find the player with the most cards
  //   const leader = game.all(Player).maxBy(p => p.allMy(Card).length);
  //
  // **Custom Player types**: If you use a custom Player subclass, set
  // `static PlayerClass = MyPlayer` on your Game class:
  //
  //   class MyGame extends Game<MyGame, MyPlayer> {
  //     static PlayerClass = MyPlayer;
  //   }
  //
  // This ensures these helpers return your custom type with full type safety.
  //
  // **Anti-patterns to avoid:**
  //
  // 1. **Don't cache player references** - Player objects may be recreated during
  //    state restoration (undo, redo, AI simulation). Always query fresh:
  //      // WRONG: const player = game.getPlayer(1); ... later use player
  //      // RIGHT: always call game.getPlayer(1) when you need it
  //
  // 2. **Don't use fallbacks when player not found** - If getPlayer() returns
  //    undefined, that's a bug. Use getPlayerOrThrow() in actions where the
  //    player must exist, and fix the root cause rather than masking it.
  //
  // 3. **Don't duplicate player data** - Store data on the Player instance,
  //    not redundantly on owned elements. Query the player when you need data.
  //
  // @see {@link Player} for player-side methods like `allMy()`, `my()`
  // ============================================

  /**
   * Get all players in the game.
   *
   * Returns players in position order (Player 1, Player 2, etc.).
   * This is the preferred way to iterate over all players.
   *
   * @example
   * ```typescript
   * // Deal to all players
   * for (const player of game.players) {
   *   deck.dealTo(player.hand, 5);
   * }
   *
   * // Find richest player
   * const richest = game.players.reduce((max, p) =>
   *   p.gold > max.gold ? p : max
   * );
   * ```
   */
  get players(): P[] {
    return (this._t.children as GameElement[])
      .filter((el): el is P => (el as any).$type === 'player')
      .sort((a, b) => a.position - b.position);
  }

  /**
   * Get the current player (the player whose turn it is).
   *
   * The current player is determined by the `_isCurrent` flag on Player instances,
   * managed via `setCurrentPlayer()` and the flow engine.
   *
   * @returns The current player, or `undefined` if no player is current
   *
   * @example
   * ```typescript
   * // In a flow action
   * const player = game.currentPlayer;
   * if (player) {
   *   player.gold += 10;
   * }
   *
   * // In an eachPlayer flow, currentPlayer is automatically set
   * eachPlayer({
   *   do: actionStep({
   *     actions: ['takeTurn'],
   *     // game.currentPlayer is the player whose turn it is
   *   })
   * })
   * ```
   *
   * @see {@link setCurrentPlayer} - Change the current player
   * @see {@link Player.isCurrent} - Check if a specific player is current
   */
  get currentPlayer(): P | undefined {
    // Find current player directly without instanceof check.
    // This avoids issues when code is bundled (esbuild creates separate class copies).
    // Players are direct children of game with numeric position property and isCurrent method.
    return this._t.children.find(
      el => typeof (el as any).position === 'number' && (el as any).isCurrent?.()
    ) as P | undefined;
  }

  /**
   * Get the first player (position 1).
   *
   * Shorthand for `game.getPlayer(1)`. Useful for first-player-related logic.
   *
   * @returns Player at position 1, or `undefined` if no players
   *
   * @example
   * ```typescript
   * // Give first player advantage
   * if (player === game.firstPlayer) {
   *   player.gold += 5;
   * }
   *
   * // Start with first player
   * game.setCurrentPlayer(game.firstPlayer!);
   * ```
   *
   * @see {@link getPlayer} - Get player by any position
   * @see {@link Player.isFirstPlayer} - Check if a player is first
   */
  get firstPlayer(): P | undefined {
    return this.getPlayer(1);
  }

  /**
   * Get a player by their position (1-indexed).
   *
   * Positions are assigned at game creation and remain constant. Use position
   * as a stable identifier for players across serialization/deserialization.
   *
   * @param position - Player position (1 = first player, 2 = second player, etc.)
   * @returns The player at that position, or `undefined` if not found
   *
   * @example
   * ```typescript
   * // Get specific players
   * const player1 = game.getPlayer(1);
   * const player2 = game.getPlayer(2);
   *
   * // With custom Player type (type assertion needed for custom properties)
   * const player = game.getPlayer(1) as MyPlayer;
   * console.log(player.customProperty);
   * ```
   *
   * @see {@link getPlayerOrThrow} - Throws if player not found (use in actions)
   * @see {@link Player.position} - The position property on players
   */
  getPlayer(position: number): P | undefined {
    // Find player by position directly without instanceof check.
    // This avoids issues when code is bundled (esbuild creates separate class copies).
    // Players are direct children of game with numeric position property.
    return this._t.children.find(
      el => typeof (el as any).position === 'number' && (el as any).position === position
    ) as P | undefined;
  }

  /**
   * Get a player by position, throwing an error if not found.
   *
   * Use this in action handlers and flow logic where a player MUST exist.
   * The error message includes diagnostic info to help debug the issue.
   *
   * **Prefer this over `getPlayer()` when the player must exist** - it fails
   * loudly rather than silently returning undefined.
   *
   * @param position - Player position (1-indexed)
   * @returns The player at that position
   * @throws Error if no player exists at that position
   *
   * @example
   * ```typescript
   * // In an action - player position comes from serialized action
   * const targetPlayer = game.getPlayerOrThrow(targetPosition);
   * targetPlayer.health -= damage;
   *
   * // In flow logic
   * const player = game.getPlayerOrThrow(1);
   * player.setCurrent(true);
   * ```
   *
   * @see {@link getPlayer} - Returns undefined instead of throwing
   */
  getPlayerOrThrow(position: number): P {
    const player = this.getPlayer(position);
    if (!player) {
      throw new Error(
        `No player at position ${position}. ` +
        `This game has ${this.all(Player as unknown as ElementClass<P>).length} players.`
      );
    }
    return player;
  }

  /**
   * Set the current player (whose turn it is).
   *
   * Automatically clears the previous current player before setting the new one.
   * Accepts either a Player object or a position number.
   *
   * @param playerOrPosition - Player object or position number (1-indexed)
   * @throws Error if position doesn't correspond to an existing player
   *
   * @example
   * ```typescript
   * // Set by player object
   * game.setCurrentPlayer(player);
   *
   * // Set by position
   * game.setCurrentPlayer(1);
   *
   * // Advance to next player in a turn-based game
   * game.setCurrentPlayer(game.nextPlayer()!);
   *
   * // In a manual turn flow
   * action('endTurn')
   *   .do(() => {
   *     const next = game.nextPlayer();
   *     if (next) game.setCurrentPlayer(next);
   *   })
   * ```
   *
   * @see {@link currentPlayer} - Get the current player
   * @see {@link nextPlayer} - Get the next player in turn order
   */
  setCurrentPlayer(playerOrPosition: P | number): void {
    // Clear previous current
    const prev = this.currentPlayer;
    if (prev) {
      prev.setCurrent(false);
    }

    // Set new current
    const player = typeof playerOrPosition === 'number'
      ? this.getPlayerOrThrow(playerOrPosition)
      : playerOrPosition;
    player.setCurrent(true);
  }

  /**
   * Get the next player after the current player (circular turn order).
   *
   * Returns the player with the next-highest position, wrapping from the last
   * player back to player 1. Returns `undefined` if there's no current player.
   *
   * In a 4-player game: Player 1 → 2 → 3 → 4 → 1 → ...
   *
   * @returns The next player in turn order, or `undefined` if no current player
   *
   * @example
   * ```typescript
   * // End turn and advance to next player
   * action('endTurn')
   *   .do(() => {
   *     const next = game.nextPlayer();
   *     if (next) game.setCurrentPlayer(next);
   *   })
   *
   * // Check who's up next
   * const nextUp = game.nextPlayer();
   * game.message(`${nextUp?.name} is next`);
   * ```
   *
   * @see {@link nextAfter} - Get next player after any specific player
   * @see {@link previousPlayer} - Get previous player instead
   */
  nextPlayer(): P | undefined {
    const current = this.currentPlayer;
    if (!current) return undefined;

    const players = this.all(Player as unknown as ElementClass<P>).sortBy('position');
    const idx = players.findIndex(p => p.position === current.position);
    const nextIdx = (idx + 1) % players.length;
    return players[nextIdx] as P | undefined;
  }

  /**
   * Get the previous player before the current player (circular turn order).
   *
   * Returns the player with the next-lowest position, wrapping from player 1
   * back to the last player. Returns `undefined` if there's no current player.
   *
   * In a 4-player game: Player 1 → 4 → 3 → 2 → 1 → ...
   *
   * @returns The previous player in turn order, or `undefined` if no current player
   *
   * @example
   * ```typescript
   * // Go back to previous player (undo last turn change)
   * const prev = game.previousPlayer();
   * if (prev) game.setCurrentPlayer(prev);
   *
   * // Reverse turn order mechanic
   * action('reverseOrder')
   *   .do(() => {
   *     game.setCurrentPlayer(game.previousPlayer()!);
   *   })
   * ```
   *
   * @see {@link previousBefore} - Get previous player before any specific player
   * @see {@link nextPlayer} - Get next player instead
   */
  previousPlayer(): P | undefined {
    const current = this.currentPlayer;
    if (!current) return undefined;

    const players = this.all(Player as unknown as ElementClass<P>).sortBy('position');
    const idx = players.findIndex(p => p.position === current.position);
    const prevIdx = (idx - 1 + players.length) % players.length;
    return players[prevIdx] as P | undefined;
  }

  /**
   * Get the next player after a specific player (circular turn order).
   *
   * Unlike `nextPlayer()`, this takes any player as input rather than using
   * the current player. Useful when you need to iterate through players or
   * find who comes after a non-current player.
   *
   * @param player - The reference player
   * @returns The next player after the given player, or `undefined` if player not found
   *
   * @example
   * ```typescript
   * // Find who's clockwise from a specific player
   * const leftNeighbor = game.nextAfter(player);
   *
   * // Pass cards to the left
   * for (const player of game.all(Player)) {
   *   const recipient = game.nextAfter(player);
   *   player.hand.first(Card)?.putInto(recipient.incoming);
   * }
   *
   * // Custom turn order starting from a specific player
   * let current = startingPlayer;
   * for (let i = 0; i < game.all(Player).length; i++) {
   *   doSomething(current);
   *   current = game.nextAfter(current)!;
   * }
   * ```
   *
   * @see {@link nextPlayer} - Uses current player as reference
   * @see {@link previousBefore} - Get player before any specific player
   */
  nextAfter(player: P): P | undefined {
    const players = this.all(Player as unknown as ElementClass<P>).sortBy('position');
    const idx = players.findIndex(p => p.position === player.position);
    if (idx === -1) return undefined;
    const nextIdx = (idx + 1) % players.length;
    return players[nextIdx] as P | undefined;
  }

  /**
   * Get the previous player before a specific player (circular turn order).
   *
   * Unlike `previousPlayer()`, this takes any player as input rather than using
   * the current player. Useful for finding neighbors or reverse iteration.
   *
   * @param player - The reference player
   * @returns The previous player before the given player, or `undefined` if player not found
   *
   * @example
   * ```typescript
   * // Find who's counter-clockwise from a specific player
   * const rightNeighbor = game.previousBefore(player);
   *
   * // Pass cards to the right
   * for (const player of game.all(Player)) {
   *   const recipient = game.previousBefore(player);
   *   player.hand.first(Card)?.putInto(recipient.incoming);
   * }
   * ```
   *
   * @see {@link previousPlayer} - Uses current player as reference
   * @see {@link nextAfter} - Get player after any specific player
   */
  previousBefore(player: P): P | undefined {
    const players = this.all(Player as unknown as ElementClass<P>).sortBy('position');
    const idx = players.findIndex(p => p.position === player.position);
    if (idx === -1) return undefined;
    const prevIdx = (idx - 1 + players.length) % players.length;
    return players[prevIdx] as P | undefined;
  }

  /**
   * Get all players other than the specified player.
   *
   * Useful for targeting opponents or excluding a player from a selection.
   *
   * @param player - The player to exclude
   * @returns Array of all other players
   *
   * @example
   * ```typescript
   * // Get all opponents
   * const opponents = game.others(currentPlayer);
   *
   * // Deal damage to all other players
   * for (const opponent of game.others(attacker)) {
   *   opponent.health -= 1;
   * }
   *
   * // Create choices for target selection (other players only)
   * action('attack')
   *   .chooseFrom('target', {
   *     prompt: 'Choose target',
   *     choices: ctx => game.others(ctx.player).map(p => ({
   *       value: p.position,
   *       display: p.name
   *     }))
   *   })
   * ```
   *
   * @see {@link playerChoices} - Build choice arrays for actions
   */
  others(player: P): P[] {
    return [...this.all(Player as unknown as ElementClass<P>)].filter(
      p => p.position !== player.position
    ) as P[];
  }

  /**
   * Get player choices formatted for use with `chooseFrom` selection.
   *
   * Returns an array of choice objects with player position as `value` (stable
   * across serialization) and player name as `display`.
   *
   * @param options - Configuration options
   * @param options.excludeSelf - If true, excludes the current player from choices
   * @param options.filter - Optional predicate to filter which players appear
   * @param options.currentPlayer - The player making the choice (required if excludeSelf is true)
   * @returns Array of choice objects for use with `chooseFrom`
   *
   * @example
   * ```typescript
   * // Choose any other player as target
   * action('attack')
   *   .chooseFrom('target', {
   *     prompt: 'Choose a player to attack',
   *     choices: ctx => game.playerChoices({
   *       excludeSelf: true,
   *       currentPlayer: ctx.player
   *     }),
   *   })
   *   .do(({ target }) => {
   *     const targetPlayer = game.getPlayerOrThrow(target);
   *     targetPlayer.health -= 1;
   *   })
   *
   * // Choose from players meeting a condition
   * action('heal')
   *   .chooseFrom('target', {
   *     prompt: 'Choose a wounded player',
   *     choices: ctx => game.playerChoices({
   *       filter: p => p.health < p.maxHealth
   *     }),
   *   })
   *
   * // Choose any player including self
   * action('inspect')
   *   .chooseFrom('target', {
   *     prompt: 'Choose a player',
   *     choices: () => game.playerChoices(),
   *   })
   * ```
   *
   * @see {@link others} - Get array of other players directly
   * @see {@link getPlayerOrThrow} - Convert position back to player
   */
  playerChoices(options: {
    excludeSelf?: boolean;
    filter?: (player: P) => boolean;
    currentPlayer?: Player;
  } = {}): { value: number; display: string }[] {
    let players = [...this.all(Player as unknown as ElementClass<P>)] as P[];

    if (options.excludeSelf && options.currentPlayer) {
      players = players.filter(p => p.position !== options.currentPlayer!.position);
    }

    if (options.filter) {
      players = players.filter(options.filter);
    }

    return players.map(p => ({
      value: p.position,
      display: p.name ?? `Player ${p.position}`,
    }));
  }

  // ============================================
  // Game Lifecycle
  // ============================================

  /**
   * Start the game (called after setup).
   *
   * Transitions the game from 'setup' phase to 'started' phase.
   * Typically called automatically by the flow engine.
   *
   * @throws Error if the game has already started
   */
  start(): void {
    if (this.phase !== 'setup') {
      throw new Error('Game has already started');
    }
    this.phase = 'started';
  }

  /**
   * End the game with optional winners.
   *
   * Transitions the game to 'finished' phase. Once finished, no more
   * actions can be taken. Use `getWinners()` to retrieve the winners.
   *
   * @param winners - Optional array of winning players. If not provided,
   *                  use `getWinners()` to let the flow engine determine winners.
   *
   * @example
   * ```typescript
   * // End with a single winner
   * this.finish([player]);
   *
   * // End with multiple winners (tie)
   * this.finish([player1, player2]);
   *
   * // End without specifying winners (flow's getWinners will be used)
   * this.finish();
   * ```
   */
  finish(winners?: P[]): void {
    this.phase = 'finished';
    if (winners) {
      this.settings.winners = winners.map(p => p.position);
    }
  }

  /**
   * Check if the game is finished.
   *
   * @returns `true` if the game phase is 'finished'
   *
   * @example
   * ```typescript
   * // In a flow condition
   * loop({
   *   while: () => !this.isFinished(),
   *   do: eachPlayer({ ... })
   * })
   * ```
   */
  isFinished(): boolean {
    return this.phase === 'finished';
  }

  /**
   * Get the winners of the game.
   *
   * @returns Array of winning players, or empty array if no winners set
   *
   * @example
   * ```typescript
   * if (game.isFinished()) {
   *   const winners = game.getWinners();
   *   if (winners.length === 1) {
   *     console.log(`${winners[0].name} wins!`);
   *   } else if (winners.length > 1) {
   *     console.log(`Tie between ${winners.map(p => p.name).join(' and ')}!`);
   *   }
   * }
   * ```
   */
  getWinners(): P[] {
    const positions = this.settings.winners as number[] | undefined;
    if (!positions) return [];
    return positions.map(pos => this.getPlayer(pos)).filter((p): p is P => p !== undefined);
  }

  // ============================================
  // Player Context
  // ============================================

  /**
   * Set the current player context for "mine" queries
   * @param player - Player object or 1-indexed position
   */
  setPlayerContext(player: P | number | undefined): void {
    if (player === undefined) {
      this._ctx.player = undefined;
    } else if (typeof player === 'number') {
      this._ctx.player = this.getPlayer(player);
    } else {
      this._ctx.player = player;
    }
  }

  /**
   * Get the current player context
   */
  getPlayerContext(): P | undefined {
    return this._ctx.player as P | undefined;
  }

  // ============================================
  // Messaging
  // ============================================

  /**
   * Add a message to the game log.
   *
   * Messages are stored and can be displayed in the UI to show game history.
   * Supports template substitution with `{{key}}` placeholders.
   *
   * @param text - Message text, optionally with `{{key}}` placeholders
   * @param data - Optional data for template substitution. GameElement and Player
   *               values are automatically converted to their display names.
   *
   * @example
   * ```typescript
   * // Simple message
   * this.message('Game started!');
   *
   * // With template substitution
   * this.message('{{player}} played {{card}}', {
   *   player: currentPlayer,
   *   card: playedCard
   * });
   *
   * // In an action
   * action('attack')
   *   .chooseOnBoard('target', Piece)
   *   .do(({ target }) => {
   *     target.remove();
   *     this.message('{{player}} destroyed {{target}}', {
   *       player: ctx.player,
   *       target
   *     });
   *   })
   * ```
   */
  message(text: string, data?: Record<string, unknown>): void {
    this.addMessageInternal(text, data);
  }

  /**
   * Internal method to add a message (called by command executor)
   */
  addMessageInternal(text: string, data?: Record<string, unknown>): void {
    this.messages.push({ text, data });
  }

  /**
   * Get formatted messages (with template substitution)
   */
  getFormattedMessages(): string[] {
    return this.messages.map(({ text, data }) => {
      if (!data) return text;
      let processed = text;
      for (const [key, value] of Object.entries(data)) {
        const replacement = value instanceof GameElement
          ? value.toString()
          : value instanceof Player
            ? (value.name ?? `Player ${value.position}`)
            : String(value);
        processed = processed.replace(new RegExp(`{{${key}}}`, 'g'), replacement);
      }
      return processed;
    });
  }

  // ============================================
  // Serialization
  // ============================================

  /**
   * Serialize the complete game state
   */
  override toJSON(): ElementJSON & {
    phase: GamePhase;
    messages: Array<{ text: string; data?: Record<string, unknown> }>;
    settings: Record<string, unknown>;
  } {
    return {
      ...super.toJSON(),
      phase: this.phase,
      messages: this.messages,
      settings: this.settings,
    };
  }

  /**
   * Get the game state from the perspective of a specific player
   * (hides elements that player shouldn't see based on zone visibility)
   * @param player - Player, player position, or null for spectator view
   */
  toJSONForPlayer(player: P | number | null): ElementJSON {
    const position = player === null ? null : (typeof player === 'number' ? player : player.position);
    // For visibility checks, spectators use -1 (no special access)
    const visibilityPosition = position ?? -1;

    const filterElement = (json: ElementJSON, element: GameElement): ElementJSON | null => {
      const visibility = element.getEffectiveVisibility();

      // Handle count-only mode: show count but not contents
      // Preserve element name and $-prefixed system attributes (like $type) for AutoUI rendering
      if (visibility.mode === 'count-only' && !element.isVisibleTo(visibilityPosition)) {
        const systemAttrs: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(json.attributes ?? {})) {
          if (key.startsWith('$')) {
            systemAttrs[key] = value;
          }
        }
        return {
          className: json.className,
          id: json.id,
          name: json.name,
          attributes: systemAttrs,
          childCount: element._t.children.length,
        };
      }

      // Check if element is visible to this player
      if (!element.isVisibleTo(visibilityPosition)) {
        // Return a hidden placeholder
        return {
          className: json.className,
          id: json.id,
          attributes: { __hidden: true },
        };
      }

      // Check zone visibility for children (if this is a Space)
      const zoneVisibility = (element as any).getZoneVisibility?.();

      // If zone has hidden or count-only visibility, handle children specially
      if (zoneVisibility) {
        if (zoneVisibility.mode === 'hidden' || zoneVisibility.mode === 'count-only') {
          // Hidden and count-only modes: create anonymized placeholders for children
          // This allows the UI to render the correct number and type of elements
          // without revealing their identity (no real IDs or names that could be used to cheat)
          const hiddenChildren: ElementJSON[] = [];
          if (json.children) {
            for (let i = 0; i < json.children.length; i++) {
              const childJson = json.children[i];
              // Only include $-prefixed system attributes (for rendering info like $images, $type)
              const systemAttrs: Record<string, unknown> = { __hidden: true };
              for (const [key, value] of Object.entries(childJson.attributes ?? {})) {
                if (key.startsWith('$')) {
                  systemAttrs[key] = value;
                }
              }
              hiddenChildren.push({
                className: childJson.className,
                // Use negative index-based IDs to prevent correlation with real element IDs
                id: -(element._t.id * 1000 + i),
                attributes: systemAttrs,
                // Don't include name - could reveal card identity
              });
            }
          }
          return {
            ...json,
            children: hiddenChildren.length > 0 ? hiddenChildren : undefined,
            childCount: element._t.children.length,
          };
        } else if (zoneVisibility.mode === 'owner' && element.player?.position !== visibilityPosition) {
          // Owner-only zone and this player doesn't own it - show hidden placeholders
          // Preserve $-prefixed system attributes (like $type) for proper AutoUI rendering
          const hiddenChildren: ElementJSON[] = [];
          if (json.children) {
            for (const childJson of json.children) {
              const systemAttrs: Record<string, unknown> = { __hidden: true };
              for (const [key, value] of Object.entries(childJson.attributes ?? {})) {
                if (key.startsWith('$')) {
                  systemAttrs[key] = value;
                }
              }
              hiddenChildren.push({
                className: childJson.className,
                id: childJson.id,
                attributes: systemAttrs,
              });
            }
          }
          return {
            ...json,
            children: hiddenChildren.length > 0 ? hiddenChildren : undefined,
          };
        }
      }

      // Filter children normally
      const filteredChildren: ElementJSON[] = [];
      if (json.children) {
        for (let i = 0; i < json.children.length; i++) {
          const childJson = json.children[i];
          const childElement = element._t.children[i];
          const filtered = filterElement(childJson, childElement);
          if (filtered) {
            filteredChildren.push(filtered);
          }
        }
      }

      return {
        ...json,
        children: filteredChildren.length > 0 ? filteredChildren : undefined,
      };
    };

    const fullJson = this.toJSON();
    let filteredState = filterElement(fullJson, this) ?? fullJson;

    // Apply playerView transformation if defined
    const GameClass = this.constructor as typeof Game;
    if (GameClass.playerView) {
      filteredState = GameClass.playerView(filteredState, position, this);
    }

    return filteredState;
  }

  /**
   * Create a game from serialized JSON
   */
  static restoreGame<G extends Game>(
    json: ReturnType<G['toJSON']>,
    GameClass: new (options: GameOptions) => G,
    classRegistry: Map<string, ElementClass>
  ): G {
    // Count players from serialized children (players are now part of the element tree)
    const playerChildren = json.children?.filter(c => c.className === 'Player') ?? [];
    const playerCount = playerChildren.length;
    const playerNames = playerChildren.map(p => p.name as string);

    const game = new GameClass({
      playerCount,
      playerNames,
    });

    // Merge class registry
    for (const [name, cls] of classRegistry) {
      game._ctx.classRegistry.set(name, cls);
    }

    // Restore state from JSON
    game.phase = json.phase;
    game.messages = json.messages;
    game.settings = json.settings;

    // Clear auto-created children and restore from JSON
    game._t.children = [];
    if (json.children) {
      for (const childJson of json.children) {
        const child = GameElement.fromJSON(childJson, game._ctx, game._ctx.classRegistry);
        child._t.parent = game;
        (child as GameElement).game = game;
        game._t.children.push(child);
      }
    }

    // Resolve element references in all restored elements
    // This converts { __elementRef: "path" } objects back to actual element references
    game.resolveElementReferences(game);

    return game;
  }
}
