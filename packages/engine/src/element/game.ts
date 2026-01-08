import { Space } from './space.js';
import { GameElement } from './game-element.js';
import type { ElementContext, ElementClass, ElementJSON } from './types.js';
import { Player, PlayerCollection } from '../player/player.js';
import type { GameCommand, CommandResult } from '../command/types.js';
import { executeCommand } from '../command/executor.js';
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
 * Extend this class to create your game.
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

  /** Container for removed elements */
  pile!: GameElement;

  /** All players in the game */
  players: PlayerCollection<P> = new PlayerCollection<P>();

  /**
   * Get the first player (position 1).
   * Shorthand for `this.players.get(1)`.
   */
  get firstPlayer(): P {
    return this.players.getOrThrow(1);
  }

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
    'pile', 'players', 'phase', 'random', 'messages', 'settings',
    'commandHistory', '_actions', '_actionExecutor', '_flowDefinition',
    '_flowEngine', '_debugRegistry', '_persistentMaps',
  ]);

  static override unserializableAttributes = [
    ...Space.unserializableAttributes,
    'pile',
    'players',
    'random',
    'commandHistory',
    '_actions',
    '_actionExecutor',
    '_flowDefinition',
    '_flowEngine',
    '_debugRegistry',
  ];

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

    // Create players (1-indexed: Player 1 has position 1)
    for (let i = 0; i < options.playerCount; i++) {
      const name = options.playerNames?.[i] ?? `Player ${i + 1}`;
      const player = this.createPlayer(i + 1, name);  // 1-indexed position
      player.game = this as unknown as Game;
      this.players.add(player as P);
    }

    // Set first player as current
    if (this.players.length > 0) {
      this.players.setCurrent(1);  // Position 1 is first player
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
    for (const player of this.players) {
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

  /**
   * Factory method to create players - override to use custom Player class
   */
  protected createPlayer(position: number, name: string): P {
    return new Player(position, name) as P;
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
    const result = executeCommand(this, command);
    if (result.success) {
      this.commandHistory.push(command);
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
    }
  }

  // ============================================
  // Action System
  // ============================================

  /**
   * Register an action definition
   */
  registerAction(action: ActionDefinition): void {
    this._actions.set(action.name, action);
  }

  /**
   * Register multiple actions
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
    const player = this.players.get(serialized.player);
    if (!player) {
      return { success: false, error: `Invalid player position: ${serialized.player}. Expected 1 to ${this.players.length}.` };
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
          conditionNote = 'Condition returned false (use ConditionTracer for details)';
        }
      } else {
        reason = 'Condition returned false';
        conditionNote = 'Condition returned false (use ConditionTracer in your condition for detailed info)';
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
   * Set the flow definition for this game
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
   * Restore flow from serialized position
   */
  restoreFlow(position: FlowPosition): void {
    if (!this._flowDefinition) {
      throw new Error('No flow definition set');
    }

    this._flowEngine = new FlowEngine(this, this._flowDefinition);
    this._flowEngine.restore(position);
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
      return this.players.get(state.currentPlayer);
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

  /**
   * Get player choices for use with chooseFrom selection.
   * Returns an array of choices with player position as value and name as display.
   *
   * @param options.excludeSelf - If true, excludes the current player from choices
   * @param options.filter - Optional filter function to narrow down players
   * @param options.currentPlayer - The current player (required if excludeSelf is true)
   *
   * @example
   * ```typescript
   * .chooseFrom('target', {
   *   prompt: 'Choose a player',
   *   choices: (ctx) => game.playerChoices({ excludeSelf: true, currentPlayer: ctx.player }),
   * })
   * ```
   */
  playerChoices(options: {
    excludeSelf?: boolean;
    filter?: (player: P) => boolean;
    currentPlayer?: Player;
  } = {}): { value: number; display: string }[] {
    let players = [...this.players] as P[];

    if (options.excludeSelf && options.currentPlayer) {
      players = players.filter(p => p.position !== options.currentPlayer!.position);
    }

    if (options.filter) {
      players = players.filter(options.filter);
    }

    return players.map(p => ({
      value: p.position,
      display: p.name,
    }));
  }

  // ============================================
  // Game Lifecycle
  // ============================================

  /**
   * Start the game (called after setup)
   */
  start(): void {
    if (this.phase !== 'setup') {
      throw new Error('Game has already started');
    }
    this.phase = 'started';
  }

  /**
   * End the game
   */
  finish(winners?: P[]): void {
    this.phase = 'finished';
    if (winners) {
      this.settings.winners = winners.map(p => p.position);
    }
  }

  /**
   * Check if the game is finished
   */
  isFinished(): boolean {
    return this.phase === 'finished';
  }

  /**
   * Get the winners (if game is finished)
   */
  getWinners(): P[] {
    const positions = this.settings.winners as number[] | undefined;
    if (!positions) return [];
    return positions.map(pos => this.players.get(pos)).filter((p): p is P => p !== undefined);
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
      this._ctx.player = this.players.get(player);
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
   * Add a message to the game log
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
            ? value.name
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
    players: Record<string, unknown>[];
    phase: GamePhase;
    messages: Array<{ text: string; data?: Record<string, unknown> }>;
    settings: Record<string, unknown>;
  } {
    return {
      ...super.toJSON(),
      players: this.players.toJSON(),
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
    const game = new GameClass({
      playerCount: json.players.length,
      playerNames: json.players.map(p => p.name as string),
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
