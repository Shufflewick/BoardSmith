import { Space } from './space.js';
import { GameElement } from './game-element.js';
import type { ElementContext, ElementClass, ElementJSON } from './types.js';
import { Player, PlayerCollection } from '../player/player.js';
import type { GameCommand, CommandResult } from '../command/types.js';
import { executeCommand } from '../command/executor.js';
import type { ActionDefinition, ActionResult, SerializedAction } from '../action/types.js';
import { ActionExecutor } from '../action/action.js';
import type { FlowDefinition, FlowState, FlowPosition } from '../flow/types.js';
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

    // Create players
    for (let i = 0; i < options.playerCount; i++) {
      const name = options.playerNames?.[i] ?? `Player ${i + 1}`;
      const player = this.createPlayer(i, name);
      player.game = this as unknown as Game;
      this.players.push(player as P);
    }

    // Set first player as current
    if (this.players.length > 0) {
      this.players.setCurrent(0);
    }

    // Initialize action executor
    this._actionExecutor = new ActionExecutor(this);
  }

  /**
   * Factory method to create players - override to use custom Player class
   */
  protected createPlayer(position: number, name: string): P {
    return new Player(position, name) as P;
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
    const player = this.players[serialized.player];
    if (!player) {
      return { success: false, error: `Invalid player: ${serialized.player}` };
    }

    return this.performAction(serialized.name, player as P, serialized.args);
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
      return this.players[state.currentPlayer];
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
    return positions.map(pos => this.players[pos]);
  }

  // ============================================
  // Player Context
  // ============================================

  /**
   * Set the current player context for "mine" queries
   */
  setPlayerContext(player: P | number | undefined): void {
    if (player === undefined) {
      this._ctx.player = undefined;
    } else if (typeof player === 'number') {
      this._ctx.player = this.players[player];
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
        if (zoneVisibility.mode === 'hidden') {
          // Send children as hidden placeholders with $-prefixed attributes preserved
          // This allows the UI to render actual card backs with proper images
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
            childCount: element._t.children.length,
          };
        } else if (zoneVisibility.mode === 'count-only') {
          // Show count but not actual children
          return {
            ...json,
            children: undefined,
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

    return game;
  }
}
