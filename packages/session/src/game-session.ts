/**
 * Core GameSession class for managing game state and lifecycle
 */

import type { FlowState, SerializedAction, Game, PendingActionState, GameCommand } from '@boardsmith/engine';
import { executeCommand } from '@boardsmith/engine';
import { GameRunner } from '@boardsmith/runtime';
import {
  ErrorCode,
  type GameClass,
  type GameDefinition,
  type StoredGameState,
  type PlayerGameState,
  type SessionInfo,
  type StateUpdate,
  type StorageAdapter,
  type BroadcastAdapter,
  type AIConfig,
  type LobbyState,
  type LobbySlot,
  type LobbyInfo,
  type LobbyUpdate,
  type PlayerConfig,
  type PlayerOptionDefinition,
  type GameOptionDefinition,
  type SelectionChoicesResponse,
} from './types.js';
import { buildPlayerState, computeUndoInfo, buildActionTraces, buildSingleActionMetadata } from './utils.js';
import { AIController } from './ai-controller.js';

// ============================================
// Types
// ============================================

/**
 * Options for creating a new game session
 */
export interface GameSessionOptions<G extends Game = Game> {
  gameType: string;
  GameClass: GameClass<G>;
  playerCount: number;
  playerNames: string[];
  playerIds?: string[];
  seed?: string;
  storage?: StorageAdapter;
  aiConfig?: AIConfig;
  /** Game-specific options (boardSize, targetScore, etc.) */
  gameOptions?: Record<string, unknown>;
  /** Display name for lobby UI */
  displayName?: string;
  /** Per-player configurations (for lobby) */
  playerConfigs?: PlayerConfig[];
  /** Creator's player ID */
  creatorId?: string;
  /** Whether to use lobby flow (game waits for players to join) */
  useLobby?: boolean;
  /** Player options definitions (for initializing defaults) */
  playerOptionsDefinitions?: Record<string, PlayerOptionDefinition>;
  /** Game options definitions (for host to modify in lobby) */
  gameOptionsDefinitions?: Record<string, GameOptionDefinition>;
}

/**
 * Result of performing an action
 */
export interface ActionResult {
  success: boolean;
  error?: string;
  /** Programmatic error code for switch statements. See ErrorCode enum. */
  errorCode?: import('./types.js').ErrorCode;
  flowState?: FlowState;
  state?: PlayerGameState;
  serializedAction?: SerializedAction;
  /** Additional data returned by the action's execute() */
  data?: Record<string, unknown>;
  /** Message from the action (for logging/display) */
  message?: string;
  /** Optional follow-up action to chain after this action */
  followUp?: {
    action: string;
    args?: Record<string, unknown>;
  };
}

/**
 * Result of undoing actions
 */
export interface UndoResult {
  success: boolean;
  error?: string;
  /** Programmatic error code for switch statements. See ErrorCode enum. */
  errorCode?: ErrorCode;
  flowState?: FlowState;
  state?: PlayerGameState;
  /** Number of actions that were undone */
  actionsUndone?: number;
}

/**
 * Element-level diff between two game states
 */
export interface ElementDiff {
  /** Element IDs that were added */
  added: number[];
  /** Element IDs that were removed */
  removed: number[];
  /** Element IDs that changed (attributes, children, etc.) */
  changed: number[];
  /** The from action index */
  fromIndex: number;
  /** The to action index */
  toIndex: number;
}

// ============================================
// GameSession Class
// ============================================

/**
 * Core game session that manages game state, actions, and real-time updates.
 *
 * This class is platform-agnostic and uses adapters for storage and broadcasting.
 * It handles:
 * - Game lifecycle (create, restore)
 * - Action processing
 * - State management
 * - Broadcasting to connected clients
 * - AI player integration (optional)
 *
 * @example
 * ```typescript
 * // Create a new game
 * const session = GameSession.create({
 *   gameType: 'checkers',
 *   GameClass: CheckersGame,
 *   playerCount: 2,
 *   playerNames: ['Alice', 'Bob'],
 *   aiConfig: { players: [1], level: 'medium' },
 * });
 *
 * // Set up broadcasting
 * session.setBroadcaster(myBroadcastAdapter);
 *
 * // Perform actions
 * const result = await session.performAction('move', 0, { from: 'a3', to: 'b4' });
 * ```
 */
export class GameSession<G extends Game = Game, TSession extends SessionInfo = SessionInfo> {
  /** Timeout duration before auto-kicking disconnected players (30 seconds) */
  static readonly DISCONNECT_TIMEOUT_MS = 30000;

  #runner: GameRunner<G>;
  readonly #storedState: StoredGameState;
  #GameClass: GameClass<G>;
  readonly #storage?: StorageAdapter;
  #aiController?: AIController<G>;  // Mutable for dynamic AI slot changes
  #broadcaster?: BroadcastAdapter<TSession>;
  #displayName?: string;
  /** Map of playerId -> disconnect timeout handle for auto-kick */
  #disconnectTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  /** Map of player position -> pending action state for repeating selections */
  #pendingActions: Map<number, PendingActionState> = new Map();

  private constructor(
    runner: GameRunner<G>,
    storedState: StoredGameState,
    GameClass: GameClass<G>,
    storage?: StorageAdapter,
    aiController?: AIController<G>,
    displayName?: string
  ) {
    this.#runner = runner;
    this.#storedState = storedState;
    this.#GameClass = GameClass;
    this.#storage = storage;
    this.#aiController = aiController;
    this.#displayName = displayName;
  }

  // ============================================
  // Factory Methods
  // ============================================

  /**
   * Create a new game session
   */
  static create<G extends Game = Game>(options: GameSessionOptions<G>): GameSession<G> {
    const {
      gameType,
      GameClass,
      playerCount,
      playerNames,
      playerIds,
      seed,
      storage,
      aiConfig,
      gameOptions: customGameOptions,
      displayName,
      playerConfigs,
      creatorId,
      useLobby,
      playerOptionsDefinitions,
      gameOptionsDefinitions,
    } = options;

    const gameSeed = seed ?? Math.random().toString(36).substring(2) + Date.now().toString(36);

    const runner = new GameRunner<G>({
      GameClass,
      gameType,
      gameOptions: { playerCount, playerNames, seed: gameSeed, ...customGameOptions },
    });

    // Build lobby slots from player configs
    let lobbySlots: LobbySlot[] | undefined;
    let lobbyState: LobbyState | undefined;

    if (useLobby && playerConfigs) {
      lobbySlots = playerConfigs.map((config, i) => {
        const isAI = config.isAI ?? false;
        const position = i + 1; // 1-indexed positions
        const isCreator = position === 1; // Position 1 is always the creator

        // Extract player options (everything except name, isAI, aiLevel)
        const playerOptions: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(config)) {
          if (!['name', 'isAI', 'aiLevel'].includes(key)) {
            playerOptions[key] = value;
          }
        }

        return {
          position,
          status: isAI ? 'ai' : (isCreator ? 'claimed' : 'open'),
          name: config.name ?? (isAI ? 'Bot' : `Player ${position}`),
          playerId: isCreator ? creatorId : undefined,
          aiLevel: isAI ? (config.aiLevel ?? 'medium') : undefined,
          playerOptions: Object.keys(playerOptions).length > 0 ? playerOptions : undefined,
          // AI is always ready, humans start not ready
          ready: isAI ? true : false,
        } as LobbySlot;
      });

      // Initialize default player options for the host (position 0)
      if (playerOptionsDefinitions && lobbySlots[0]?.status === 'claimed') {
        lobbySlots[0].playerOptions = GameSession.computeDefaultPlayerOptions(
          0,
          playerOptionsDefinitions,
          lobbySlots,
          playerCount
        );
      }

      // Always start in 'waiting' state when using lobby
      // Game only starts when all players click Ready
      lobbyState = 'waiting';
    }

    const storedState: StoredGameState = {
      gameType,
      playerCount,
      playerNames,
      playerIds,
      seed: gameSeed,
      actionHistory: [],
      createdAt: Date.now(),
      aiConfig,
      gameOptions: customGameOptions,
      lobbyState,
      lobbySlots,
      creatorId,
      playerOptionsDefinitions,
      gameOptionsDefinitions,
    };

    runner.start();

    const aiController = aiConfig
      ? new AIController(GameClass, gameType, playerCount, aiConfig)
      : undefined;

    const session = new GameSession(runner, storedState, GameClass, storage, aiController, displayName);

    // Persist initial state (fire-and-forget to keep create synchronous)
    if (storage) {
      storage.save(storedState).catch(err => {
        console.error('Failed to save initial game state:', err);
      });
    }

    // Only trigger AI if game is playing (not waiting for players)
    if (lobbyState !== 'waiting' && aiController?.hasAIPlayers()) {
      session.#scheduleAICheck();
    }

    return session;
  }

  /**
   * Restore a game session from stored state
   */
  static restore<G extends Game = Game>(
    storedState: StoredGameState,
    GameClass: GameClass<G>,
    storage?: StorageAdapter
  ): GameSession<G> {
    const runner = GameRunner.replay<G>(
      {
        GameClass,
        gameType: storedState.gameType,
        gameOptions: {
          playerCount: storedState.playerCount,
          playerNames: storedState.playerNames,
          seed: storedState.seed,
          ...storedState.gameOptions,
        },
      },
      storedState.actionHistory
    );

    const aiController = storedState.aiConfig
      ? new AIController(GameClass, storedState.gameType, storedState.playerCount, storedState.aiConfig)
      : undefined;

    return new GameSession(runner, storedState, GameClass, storage, aiController);
  }

  // ============================================
  // Accessors
  // ============================================

  /**
   * Set the broadcast adapter for real-time updates
   */
  setBroadcaster(broadcaster: BroadcastAdapter<TSession>): void {
    this.#broadcaster = broadcaster;
  }

  /**
   * Get the current game runner (for advanced use cases)
   */
  get runner(): GameRunner<G> {
    return this.#runner;
  }

  /**
   * Get the stored state
   */
  get storedState(): StoredGameState {
    return this.#storedState;
  }

  /**
   * Get the game type
   */
  get gameType(): string {
    return this.#storedState.gameType;
  }

  /**
   * Get the player count
   */
  get playerCount(): number {
    return this.#storedState.playerCount;
  }

  /**
   * Get the player names
   */
  get playerNames(): string[] {
    return this.#storedState.playerNames;
  }

  // ============================================
  // State Methods
  // ============================================

  /**
   * Get the flow state
   */
  getFlowState(): FlowState | undefined {
    return this.#runner.getFlowState();
  }

  /**
   * Get the game state for a specific player
   * @param playerPosition Player's position
   * @param options.includeActionMetadata Include action metadata for auto-UI (default: true)
   * @param options.includeDebugData Include debug data from game.registerDebug() (default: true)
   */
  getState(
    playerPosition: number,
    options?: { includeActionMetadata?: boolean; includeDebugData?: boolean }
  ): { success: boolean; flowState?: FlowState; state?: PlayerGameState } {
    const flowState = this.#runner.getFlowState();
    const state = buildPlayerState(
      this.#runner,
      this.#storedState.playerNames,
      playerPosition,
      { includeActionMetadata: options?.includeActionMetadata ?? true, includeDebugData: options?.includeDebugData ?? true }
    );
    return { success: true, flowState, state };
  }

  /**
   * Build player state for a specific position
   */
  buildPlayerState(playerPosition: number, options?: { includeActionMetadata?: boolean; includeDebugData?: boolean }): PlayerGameState {
    return buildPlayerState(
      this.#runner,
      this.#storedState.playerNames,
      playerPosition,
      { includeActionMetadata: options?.includeActionMetadata ?? true, includeDebugData: options?.includeDebugData ?? true }
    );
  }

  /**
   * Update a player's name
   * @param position Player position (1-indexed)
   * @param name New name for the player
   */
  updatePlayerName(position: number, name: string): void {
    if (position < 1 || position > this.#storedState.playerCount) {
      throw new Error(`Invalid player position: ${position}. Expected 1 to ${this.#storedState.playerCount}.`);
    }
    this.#storedState.playerNames[position - 1] = name;

    // Broadcast the update to all connected clients
    this.broadcast();
  }

  /**
   * Get action history
   */
  getHistory(): { actionHistory: SerializedAction[]; createdAt: number } {
    return {
      actionHistory: this.#storedState.actionHistory,
      createdAt: this.#storedState.createdAt,
    };
  }

  /**
   * Get state at a specific action index (for time travel debugging)
   * Creates a temporary game and replays actions up to the specified index.
   */
  getStateAtAction(actionIndex: number, playerPosition: number): { success: boolean; state?: PlayerGameState; error?: string } {
    const history = this.#storedState.actionHistory;

    // Validate index
    if (actionIndex < 0 || actionIndex > history.length) {
      return { success: false, error: `Invalid action index: ${actionIndex}. History has ${history.length} actions.` };
    }

    try {
      // Get subset of actions to replay
      const actionsToReplay = history.slice(0, actionIndex);

      // Create a temporary runner and replay
      const tempRunner = GameRunner.replay<G>(
        {
          GameClass: this.#GameClass,
          gameType: this.#storedState.gameType,
          gameOptions: {
            playerCount: this.#storedState.playerCount,
            playerNames: this.#storedState.playerNames,
            seed: this.#storedState.seed,
            ...this.#storedState.gameOptions,
          },
        },
        actionsToReplay
      );

      // Build state for the requested player
      const state = buildPlayerState(
        tempRunner,
        this.#storedState.playerNames,
        playerPosition,
        { includeActionMetadata: false }
      );

      return { success: true, state };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to replay game state',
      };
    }
  }

  /**
   * Compute diff between two action points (for state diff highlighting)
   * Returns lists of element IDs that were added, removed, or changed
   */
  getStateDiff(
    fromIndex: number,
    toIndex: number,
    playerPosition: number
  ): { success: boolean; diff?: ElementDiff; error?: string } {
    const history = this.#storedState.actionHistory;

    // Validate indices
    if (fromIndex < 0 || fromIndex > history.length) {
      return { success: false, error: `Invalid fromIndex: ${fromIndex}` };
    }
    if (toIndex < 0 || toIndex > history.length) {
      return { success: false, error: `Invalid toIndex: ${toIndex}` };
    }

    try {
      // Get states at both points
      const fromResult = this.getStateAtAction(fromIndex, playerPosition);
      const toResult = this.getStateAtAction(toIndex, playerPosition);

      if (!fromResult.success || !fromResult.state) {
        return { success: false, error: fromResult.error || 'Failed to get from state' };
      }
      if (!toResult.success || !toResult.state) {
        return { success: false, error: toResult.error || 'Failed to get to state' };
      }

      // Extract element IDs from view trees, tracking parent relationships
      // Map: element id -> { parentId, attributes (without children/player metadata) }
      const fromElements = new Map<number, { parentId: number | null; attrs: string }>();
      const toElements = new Map<number, { parentId: number | null; attrs: string }>();

      function getComparableAttrs(obj: Record<string, unknown>): string {
        // Only compare attributes that represent actual game state, not metadata
        const attrs = obj.attributes as Record<string, unknown> | undefined;
        if (!attrs) return '';
        // Filter out player object (has _isCurrent that changes), keep game-relevant attrs
        const filtered: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(attrs)) {
          // Skip player objects and internal metadata
          if (key === 'player' || key === 'game' || key.startsWith('_')) continue;
          filtered[key] = value;
        }
        return JSON.stringify(filtered);
      }

      function collectElements(node: unknown, map: Map<number, { parentId: number | null; attrs: string }>, parentId: number | null = null) {
        if (!node || typeof node !== 'object') return;
        const obj = node as Record<string, unknown>;
        if (typeof obj.id === 'number') {
          map.set(obj.id, {
            parentId,
            attrs: getComparableAttrs(obj),
          });
          // Recurse into children with this node as parent
          if (Array.isArray(obj.children)) {
            for (const child of obj.children) {
              collectElements(child, map, obj.id);
            }
          }
        } else if (Array.isArray(obj.children)) {
          // Node without id, just recurse
          for (const child of obj.children) {
            collectElements(child, map, parentId);
          }
        }
      }

      collectElements(fromResult.state.view, fromElements);
      collectElements(toResult.state.view, toElements);

      // Compute diff - focus on elements that moved (parent changed) or whose attributes changed
      const added: number[] = [];
      const removed: number[] = [];
      const changed: number[] = [];

      for (const [id, toData] of toElements.entries()) {
        const fromData = fromElements.get(id);
        if (!fromData) {
          added.push(id);
        } else if (fromData.parentId !== toData.parentId || fromData.attrs !== toData.attrs) {
          // Element moved to different parent OR its attributes changed
          changed.push(id);
        }
      }

      for (const id of fromElements.keys()) {
        if (!toElements.has(id)) {
          removed.push(id);
        }
      }

      return {
        success: true,
        diff: { added, removed, changed, fromIndex, toIndex },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to compute diff',
      };
    }
  }

  /**
   * Get action traces for debugging (shows why actions are available/unavailable)
   * @param playerPosition Player's position
   */
  getActionTraces(playerPosition: number): {
    success: boolean;
    traces?: import('./types.js').ActionTrace[];
    flowContext?: {
      flowAllowedActions: string[];
      currentPlayer?: number;
      isMyTurn: boolean;
      currentPhase?: string;
    };
    error?: string;
  } {
    if (playerPosition < 1 || playerPosition > this.#storedState.playerCount) {
      return { success: false, error: `Invalid player position: ${playerPosition}. Player positions are 1-indexed (1 to ${this.#storedState.playerCount}).` };
    }

    try {
      const traces = buildActionTraces(this.#runner, playerPosition);

      // Get flow context to show which actions are restricted by flow
      const flowState = this.#runner.getFlowState();
      let flowAllowedActions: string[] = [];
      let isMyTurn = false;

      if (flowState?.awaitingInput) {
        // Handle simultaneous actions
        if (flowState.awaitingPlayers && flowState.awaitingPlayers.length > 0) {
          const playerState = flowState.awaitingPlayers.find(p => p.playerIndex === playerPosition);
          if (playerState && !playerState.completed) {
            flowAllowedActions = playerState.availableActions;
            isMyTurn = true;
          }
        } else {
          // Regular turn-based flow
          flowAllowedActions = flowState.availableActions ?? [];
          isMyTurn = flowState.currentPlayer === playerPosition;
        }
      }

      return {
        success: true,
        traces,
        flowContext: {
          flowAllowedActions,
          currentPlayer: flowState?.currentPlayer,
          isMyTurn,
          currentPhase: flowState?.currentPhase,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get action traces',
      };
    }
  }

  // ============================================
  // Action Methods
  // ============================================

  /**
   * Perform an action
   */
  async performAction(
    action: string,
    player: number,
    args: Record<string, unknown>
  ): Promise<ActionResult> {
    if (player < 1 || player > this.#storedState.playerCount) {
      return { success: false, error: `Invalid player: ${player}. Player positions are 1-indexed (1 to ${this.#storedState.playerCount}).`, errorCode: ErrorCode.INVALID_PLAYER };
    }

    const result = this.#runner.performAction(action, player, args);

    if (!result.success) {
      // Pass through error, try to infer errorCode from common patterns
      let errorCode: ErrorCode | undefined;
      if (result.error?.includes('not available')) {
        errorCode = ErrorCode.ACTION_NOT_AVAILABLE;
      } else if (result.error?.includes('not found')) {
        errorCode = ErrorCode.ACTION_NOT_FOUND;
      } else if (result.error?.includes('Invalid selection')) {
        errorCode = ErrorCode.INVALID_SELECTION;
      }
      return { success: false, error: result.error, errorCode };
    }

    // Update stored action history
    this.#storedState.actionHistory = this.#runner.actionHistory;

    // Persist if storage adapter is provided
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast to all connected clients
    this.broadcast();

    // Check if AI should respond
    this.#scheduleAICheck();

    // Build followUp with metadata if present
    const followUp = result.flowState?.followUp;
    let followUpWithMetadata: typeof followUp & { metadata?: ReturnType<typeof buildSingleActionMetadata> } | undefined;
    if (followUp) {
      const playerObj = this.#runner.game.players.get(player);
      // Pass followUp.args so dynamic prompts can access them (e.g., showing sector name)
      const followUpMetadata = playerObj ? buildSingleActionMetadata(this.#runner.game, playerObj, followUp.action, followUp.args) : undefined;
      followUpWithMetadata = {
        ...followUp,
        metadata: followUpMetadata,
      };
    }

    return {
      success: true,
      flowState: result.flowState,
      state: buildPlayerState(this.#runner, this.#storedState.playerNames, player, { includeActionMetadata: true, includeDebugData: true }),
      serializedAction: result.serializedAction,
      // Pass through action chaining info from flowState, including metadata for the followUp action
      followUp: followUpWithMetadata,
    };
  }

  // ============================================
  // Hot Reload Methods
  // ============================================

  /**
   * Reload the game with a new game definition (for hot reloading rules).
   * Replays the entire action history with the new game class.
   */
  reloadWithCurrentRules(definition: GameDefinition): void {
    // Validate game type matches
    if (definition.gameType !== this.#storedState.gameType) {
      throw new Error(`Cannot reload: game type mismatch (expected ${this.#storedState.gameType}, got ${definition.gameType})`);
    }

    // Replay all actions with the new game class
    const newRunner = GameRunner.replay<G>(
      {
        GameClass: definition.gameClass as GameClass<G>,
        gameType: this.#storedState.gameType,
        gameOptions: {
          playerCount: this.#storedState.playerCount,
          playerNames: this.#storedState.playerNames,
          seed: this.#storedState.seed,
          ...this.#storedState.gameOptions,
        },
      },
      this.#storedState.actionHistory
    );

    // DEV: Log state after reload to detect mismatches
    if (process.env.NODE_ENV !== 'production') {
      const newSequence = (newRunner.game as any)._ctx?.sequence;
      const newElementCount = newRunner.game.all().length;
      const oldSequence = (this.#runner.game as any)._ctx?.sequence;
      const oldElementCount = this.#runner.game.all().length;

      if (newSequence !== oldSequence || newElementCount !== oldElementCount) {
        console.warn(
          `[BoardSmith HMR] ⚠️ STATE MISMATCH after reload!\n` +
          `  Before: seq=${oldSequence}, elements=${oldElementCount}\n` +
          `  After:  seq=${newSequence}, elements=${newElementCount}\n` +
          `  This may cause game corruption. Check if your game has randomness outside seed control.`
        );
      } else {
        console.log(
          `[BoardSmith HMR] ✓ State matches: seq=${newSequence}, elements=${newElementCount}`
        );
      }
    }

    // Replace the current runner and game class
    this.#runner = newRunner;
    this.#GameClass = definition.gameClass as GameClass<G>;

    // Clear any pending actions (they may reference old game state)
    this.#pendingActions.clear();

    // Broadcast updated state to all clients
    this.broadcast();
  }

  // ============================================
  // Undo Methods
  // ============================================

  /**
   * Undo actions back to the start of the current player's turn.
   * Only works if it's the player's turn and they've made at least one action.
   */
  async undoToTurnStart(playerPosition: number): Promise<UndoResult> {
    // Validate player position (1-indexed)
    if (playerPosition < 1 || playerPosition > this.#storedState.playerCount) {
      return { success: false, error: `Invalid player: ${playerPosition}. Player positions are 1-indexed (1 to ${this.#storedState.playerCount}).`, errorCode: ErrorCode.INVALID_PLAYER };
    }

    // Check if it's this player's turn
    const flowState = this.#runner.getFlowState();
    if (flowState?.currentPlayer !== playerPosition) {
      return { success: false, error: "It's not your turn", errorCode: ErrorCode.NOT_YOUR_TURN };
    }

    // Compute where the turn started
    const { turnStartActionIndex, actionsThisTurn } = computeUndoInfo(
      this.#storedState.actionHistory,
      flowState.currentPlayer
    );

    // Check if there's anything to undo
    if (actionsThisTurn === 0) {
      return { success: false, error: 'No actions to undo', errorCode: ErrorCode.NO_ACTIONS_TO_UNDO };
    }

    // Replay game to the turn start point
    const actionsToReplay = this.#storedState.actionHistory.slice(0, turnStartActionIndex);

    try {
      // Create a new runner replayed to the turn start
      const newRunner = GameRunner.replay<G>(
        {
          GameClass: this.#GameClass,
          gameType: this.#storedState.gameType,
          gameOptions: {
            playerCount: this.#storedState.playerCount,
            playerNames: this.#storedState.playerNames,
            seed: this.#storedState.seed,
            ...this.#storedState.gameOptions,
          },
        },
        actionsToReplay
      );

      // Replace the current runner
      this.#runner = newRunner;

      // Update stored action history
      this.#storedState.actionHistory = actionsToReplay;

      // Persist if storage adapter is provided
      if (this.#storage) {
        await this.#storage.save(this.#storedState);
      }

      // Broadcast to all connected clients
      this.broadcast();

      const newFlowState = this.#runner.getFlowState();

      return {
        success: true,
        flowState: newFlowState,
        state: buildPlayerState(this.#runner, this.#storedState.playerNames, playerPosition, { includeActionMetadata: true, includeDebugData: true }),
        actionsUndone: actionsThisTurn,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to undo',
      };
    }
  }

  /**
   * Rewind the game to a specific action index and continue from there.
   * All actions after the target index will be discarded.
   * This is intended for debug/development use.
   */
  async rewindToAction(targetActionIndex: number): Promise<{
    success: boolean;
    error?: string;
    actionsDiscarded?: number;
    state?: PlayerGameState;
  }> {
    const currentLength = this.#storedState.actionHistory.length;

    // Validate target index
    if (targetActionIndex < 0) {
      return { success: false, error: `Invalid action index: ${targetActionIndex}` };
    }

    if (targetActionIndex >= currentLength) {
      return { success: false, error: `Cannot rewind forward: target ${targetActionIndex} >= current ${currentLength}` };
    }

    // Slice history to target point
    const actionsToReplay = this.#storedState.actionHistory.slice(0, targetActionIndex);
    const actionsDiscarded = currentLength - targetActionIndex;

    try {
      // Replay game to that point
      const newRunner = GameRunner.replay<G>(
        {
          GameClass: this.#GameClass,
          gameType: this.#storedState.gameType,
          gameOptions: {
            playerCount: this.#storedState.playerCount,
            playerNames: this.#storedState.playerNames,
            seed: this.#storedState.seed,
            ...this.#storedState.gameOptions,
          },
        },
        actionsToReplay
      );

      // Replace current state
      this.#runner = newRunner;
      this.#storedState.actionHistory = actionsToReplay;

      // Clear any pending actions (they reference old game state)
      this.#pendingActions.clear();

      // Persist
      if (this.#storage) {
        await this.#storage.save(this.#storedState);
      }

      // Broadcast new state to all clients
      this.broadcast();

      // Return state for the first player (caller should handle their own player position)
      return {
        success: true,
        actionsDiscarded,
        state: buildPlayerState(this.#runner, this.#storedState.playerNames, 1, { includeActionMetadata: true, includeDebugData: true }),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to rewind',
      };
    }
  }

  // ============================================
  // Debug Deck Manipulation Methods
  // ============================================

  /**
   * Execute a debug command against the game state.
   * Used for deck manipulation and other debug operations.
   * NOTE: These changes are NOT persisted to action history.
   *
   * @param command The command to execute
   * @returns Result with success status and error message if failed
   */
  executeDebugCommand(command: GameCommand): { success: boolean; error?: string } {
    const result = executeCommand(this.#runner.game, command);
    if (result.success) {
      // Broadcast the updated state to all clients
      this.broadcast();
    }
    return result;
  }

  /**
   * Move a card to the top of its current deck (debug only).
   * The card remains in the same parent but is moved to position 0.
   *
   * @param cardId ID of the card to move
   * @returns Result with success status
   */
  moveCardToTop(cardId: number): { success: boolean; error?: string } {
    return this.executeDebugCommand({
      type: 'REORDER_CHILD',
      elementId: cardId,
      targetIndex: 0,
    });
  }

  /**
   * Move a card to a specific position within its current deck (debug only).
   *
   * @param cardId ID of the card to move
   * @param targetIndex Target position (0-based)
   * @returns Result with success status
   */
  reorderCard(cardId: number, targetIndex: number): { success: boolean; error?: string } {
    return this.executeDebugCommand({
      type: 'REORDER_CHILD',
      elementId: cardId,
      targetIndex,
    });
  }

  /**
   * Transfer a card to a different deck (debug only).
   *
   * @param cardId ID of the card to transfer
   * @param targetDeckId ID of the destination deck
   * @param position Where to place the card in the destination ('first' or 'last')
   * @returns Result with success status
   */
  transferCard(cardId: number, targetDeckId: number, position: 'first' | 'last' = 'first'): { success: boolean; error?: string } {
    return this.executeDebugCommand({
      type: 'MOVE',
      elementId: cardId,
      destinationId: targetDeckId,
      position,
    });
  }

  /**
   * Shuffle a deck (debug only).
   *
   * @param deckId ID of the deck to shuffle
   * @returns Result with success status
   */
  shuffleDeck(deckId: number): { success: boolean; error?: string } {
    return this.executeDebugCommand({
      type: 'SHUFFLE',
      spaceId: deckId,
    });
  }

  // ============================================
  // Selection Choices Methods
  // ============================================

  /**
   * Get choices for any selection.
   * This is the unified endpoint for fetching selection choices on-demand.
   * Called when advancing to a new selection in the action flow.
   *
   * @param actionName Name of the action
   * @param selectionName Name of the selection to get choices for
   * @param playerPosition Player requesting choices
   * @param currentArgs Arguments collected so far (for dependent selections)
   * @returns Choices/elements with display strings and board refs, plus multiSelect config
   */
  getSelectionChoices(
    actionName: string,
    selectionName: string,
    playerPosition: number,
    currentArgs: Record<string, unknown> = {}
  ): SelectionChoicesResponse {
    // Validate player position (1-indexed)
    if (playerPosition < 1 || playerPosition > this.#storedState.playerCount) {
      return { success: false, error: `Invalid player: ${playerPosition}. Player positions are 1-indexed (1 to ${this.#storedState.playerCount}).`, errorCode: ErrorCode.INVALID_PLAYER };
    }

    // Get action definition
    const action = this.#runner.game.getAction(actionName);
    if (!action) {
      return { success: false, error: `Action not found: ${actionName}`, errorCode: ErrorCode.ACTION_NOT_FOUND };
    }

    // Find the selection
    const selection = action.selections.find(s => s.name === selectionName);
    if (!selection) {
      return { success: false, error: `Selection not found: ${selectionName}`, errorCode: ErrorCode.SELECTION_NOT_FOUND };
    }

    // Build context with current args (playerPosition is 1-indexed)
    const player = this.#runner.game.players.get(playerPosition);
    if (!player) {
      return { success: false, error: `Player not found at position ${playerPosition}. Expected 1 to ${this.#runner.game.players.length}.`, errorCode: ErrorCode.INVALID_PLAYER };
    }

    // Resolve any element IDs in currentArgs to actual elements
    // Handles both plain numbers (id) and serialized element objects ({ id: number, ... })
    const resolvedArgs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(currentArgs)) {
      if (typeof value === 'number') {
        // Plain element ID
        const element = this.#runner.game.getElementById(value);
        resolvedArgs[key] = element || value;
      } else if (typeof value === 'object' && value !== null && 'id' in value && typeof (value as { id: unknown }).id === 'number') {
        // Serialized element object from followUp args (e.g., { id: 123, name: 'Coffee Industry' })
        // When an action returns followUp.args with elements, they get JSON-serialized.
        // The client sends them back as objects, so we need to resolve them here.
        const element = this.#runner.game.getElementById((value as { id: number }).id);
        resolvedArgs[key] = element || value;
      } else {
        resolvedArgs[key] = value;
      }
    }

    const ctx = { game: this.#runner.game, player, args: resolvedArgs };

    // Helper function to generate default display
    const defaultDisplay = (value: unknown): string => {
      if (value === null || value === undefined) return String(value);
      if (typeof value !== 'object') return String(value);
      const obj = value as Record<string, unknown>;
      if (typeof obj.display === 'string') return obj.display;
      if (typeof obj.name === 'string') return obj.name;
      if (typeof obj.label === 'string') return obj.label;
      try { return JSON.stringify(value); } catch { return '[Complex Object]'; }
    };

    // Handle based on selection type
    switch (selection.type) {
      case 'choice': {
        const choiceSel = selection as any;

        // Evaluate choices NOW
        let choices: unknown[];
        if (typeof choiceSel.choices === 'function') {
          try {
            choices = choiceSel.choices(ctx);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: `Error evaluating choices: ${errorMsg}`, errorCode: ErrorCode.CHOICES_EVALUATION_ERROR };
          }
        } else {
          choices = choiceSel.choices || [];
        }

        // Convert to display format with board refs
        const formattedChoices = choices.map(rawValue => {
          // Check if the choice already has { value, display } structure (e.g., from playerChoices())
          // If so, use those directly instead of wrapping again
          let value: unknown;
          let display: string;

          if (rawValue && typeof rawValue === 'object' && 'value' in rawValue && 'display' in rawValue) {
            // Already formatted choice (like from playerChoices)
            const formatted = rawValue as { value: unknown; display: string };
            value = formatted.value;
            display = formatted.display;
          } else {
            // Raw value - wrap it
            value = rawValue;
            display = choiceSel.display ? choiceSel.display(rawValue) : defaultDisplay(rawValue);
          }

          const choice: any = { value, display };

          // Add board refs if provided (pass the original rawValue for compatibility)
          if (choiceSel.boardRefs) {
            try {
              const refs = choiceSel.boardRefs(rawValue, ctx);
              if (refs.sourceRef) choice.sourceRef = refs.sourceRef;
              if (refs.targetRef) choice.targetRef = refs.targetRef;
            } catch {
              // Ignore errors in boardRefs
            }
          }

          return choice;
        });

        // Evaluate multiSelect config if present
        let multiSelect: { min: number; max?: number } | undefined;
        if (choiceSel.multiSelect !== undefined) {
          const multiSelectConfig = typeof choiceSel.multiSelect === 'function'
            ? choiceSel.multiSelect(ctx)
            : choiceSel.multiSelect;

          if (multiSelectConfig !== undefined) {
            if (typeof multiSelectConfig === 'number') {
              multiSelect = { min: 1, max: multiSelectConfig };
            } else {
              multiSelect = {
                min: multiSelectConfig.min ?? 1,
                max: multiSelectConfig.max,
              };
            }
          }
        }

        return { success: true, choices: formattedChoices, multiSelect };
      }

      case 'element': {
        const elemSel = selection as any;
        let elements: any[];

        // Get elements - either from elements property or from/filter/elementClass pattern
        if (elemSel.elements) {
          if (typeof elemSel.elements === 'function') {
            try {
              elements = elemSel.elements(ctx);
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Unknown error';
              return { success: false, error: `Error evaluating elements: ${errorMsg}`, errorCode: ErrorCode.ELEMENTS_EVALUATION_ERROR };
            }
          } else {
            elements = elemSel.elements || [];
          }
        } else {
          // Original from/filter/elementClass pattern
          let from: any;

          if (typeof elemSel.from === 'function') {
            from = elemSel.from(ctx);
            // DEV WARNING: from function returned undefined/null - this will cause errors
            if (from === undefined || from === null) {
              if (process.env.NODE_ENV !== 'production') {
                console.warn(
                  `[BoardSmith] chooseElement '${selectionName}' from() returned ${from}.\n` +
                  `  This will cause errors. Check your from() function and ensure ctx.args has the expected values.\n` +
                  `  ctx.args: ${JSON.stringify(ctx.args)}`
                );
              }
              // Fall back to game to avoid crash, but this is likely a bug
              from = this.#runner.game;
            }
          } else {
            from = elemSel.from ?? this.#runner.game;
          }

          if (elemSel.elementClass) {
            elements = [...from.all(elemSel.elementClass)];
          } else {
            elements = [...from.all()];
          }

          if (elemSel.filter) {
            elements = elements.filter((e: any) => elemSel.filter!(e, ctx));
          }
        }

        // Build validElements list with display and refs
        const validElements = this.#buildValidElementsList(elements, elemSel, ctx);

        return { success: true, validElements };
      }

      case 'elements': {
        const elementsSel = selection as any;
        let elements: any[];

        if (typeof elementsSel.elements === 'function') {
          try {
            elements = elementsSel.elements(ctx);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: `Error evaluating elements: ${errorMsg}`, errorCode: ErrorCode.ELEMENTS_EVALUATION_ERROR };
          }
        } else {
          elements = elementsSel.elements || [];
        }

        // Build validElements list with display and refs
        const validElements = this.#buildValidElementsList(elements, elementsSel, ctx);

        // Evaluate multiSelect config if present
        let multiSelect: { min: number; max?: number } | undefined;
        if (elementsSel.multiSelect !== undefined) {
          const multiSelectConfig = typeof elementsSel.multiSelect === 'function'
            ? elementsSel.multiSelect(ctx)
            : elementsSel.multiSelect;

          if (multiSelectConfig !== undefined) {
            if (typeof multiSelectConfig === 'number') {
              multiSelect = { min: 1, max: multiSelectConfig };
            } else {
              multiSelect = {
                min: multiSelectConfig.min ?? 1,
                max: multiSelectConfig.max,
              };
            }
          }
        }

        return { success: true, validElements, multiSelect };
      }

      case 'number':
      case 'text':
        // These types don't have choices - return empty success
        return { success: true };

      default: {
        // Exhaustive check - this should never happen
        const _exhaustiveCheck: never = selection;
        return { success: false, error: `Unsupported selection type: ${(_exhaustiveCheck as any).type}` };
      }
    }
  }

  /**
   * Build validElements list with auto-disambiguation.
   * Used internally by getSelectionChoices.
   */
  #buildValidElementsList(
    elements: any[],
    elemSel: any,
    ctx: { game: Game; player: import('@boardsmith/engine').Player; args: Record<string, unknown> }
  ): Array<{ id: number; display: string; ref?: any }> {
    // Auto-disambiguate display names
    const nameCounts = new Map<string, number>();
    for (const el of elements) {
      const name = el.name || 'Element';
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }
    const nameIndices = new Map<string, number>();

    return elements.map((element: any) => {
      const validElem: any = { id: element.id };

      // Add display text if display function provided
      if (elemSel.display) {
        try {
          // Support both display signatures: (element, ctx) and (element, ctx, allElements)
          validElem.display = elemSel.display(element, ctx, elements);
        } catch {
          validElem.display = element.name || String(element.id);
        }
      } else {
        // Auto-disambiguation for elements with same name
        const baseName = element.name || 'Element';
        const count = nameCounts.get(baseName) || 1;
        if (count > 1) {
          const idx = (nameIndices.get(baseName) || 0) + 1;
          nameIndices.set(baseName, idx);
          validElem.display = `${baseName} #${idx}`;
        } else {
          // Default display: use element's name or notation if available
          validElem.display = element.notation || element.name || String(element.id);
        }
      }

      // Add board ref if provided
      if (elemSel.boardRef) {
        try {
          validElem.ref = elemSel.boardRef(element, ctx);
        } catch {
          // Ignore errors
        }
      } else {
        // Default ref: use element ID and notation if available
        validElem.ref = { id: element.id };
        if (element.notation) {
          validElem.ref.notation = element.notation;
        }
      }

      return validElem;
    });
  }

  // ============================================
  // Pending Action Methods (for repeating selections)
  // ============================================

  /**
   * Start a pending action for a player.
   * Used when an action has repeating selections and needs step-by-step processing.
   */
  startPendingAction(actionName: string, playerPosition: number): {
    success: boolean;
    error?: string;
    errorCode?: ErrorCode;
    pendingState?: PendingActionState;
  } {
    if (playerPosition < 1 || playerPosition > this.#storedState.playerCount) {
      return { success: false, error: `Invalid player: ${playerPosition}. Player positions are 1-indexed (1 to ${this.#storedState.playerCount}).`, errorCode: ErrorCode.INVALID_PLAYER };
    }

    const action = this.#runner.game.getAction(actionName);
    if (!action) {
      return { success: false, error: `Action not found: ${actionName}`, errorCode: ErrorCode.ACTION_NOT_FOUND };
    }

    const executor = this.#runner.game.getActionExecutor();
    const pendingState = executor.createPendingActionState(actionName, playerPosition);
    this.#pendingActions.set(playerPosition, pendingState);

    return { success: true, pendingState };
  }

  /**
   * Process a selection step for a pending action.
   * Handles both regular selections and repeating selections.
   * Auto-creates the pending action if it doesn't exist.
   * @param initialArgs - Pre-collected args from earlier selections (e.g., actingMerc before equipment)
   */
  async processSelectionStep(
    playerPosition: number,
    selectionName: string,
    value: unknown,
    actionName?: string,
    initialArgs?: Record<string, unknown>
  ): Promise<{
    success: boolean;
    error?: string;
    done?: boolean;
    nextChoices?: unknown[];
    actionComplete?: boolean;
    actionResult?: ActionResult;
    state?: PlayerGameState;
  }> {
    let pendingState = this.#pendingActions.get(playerPosition);

    // Auto-create pending action if it doesn't exist and actionName is provided
    if (!pendingState && actionName) {
      const startResult = this.startPendingAction(actionName, playerPosition);
      if (!startResult.success) {
        return { success: false, error: startResult.error };
      }
      pendingState = startResult.pendingState;
      this.#pendingActions.set(playerPosition, pendingState!);

      // If initialArgs provided, populate the pending state and advance to correct selection
      if (initialArgs && Object.keys(initialArgs).length > 0) {
        const action = this.#runner.game.getAction(actionName);
        if (action) {
          // Copy initialArgs to collectedArgs (filter out null/undefined)
          for (const [key, val] of Object.entries(initialArgs)) {
            if (val !== undefined && val !== null) {
              pendingState!.collectedArgs[key] = val;
            }
          }

          // Find the index of the selection we're about to process
          const targetIndex = action.selections.findIndex(s => s.name === selectionName);
          if (targetIndex > 0) {
            pendingState!.currentSelectionIndex = targetIndex;
          }
        }
      }
    }

    if (!pendingState) {
      return { success: false, error: 'No pending action for this player. Provide actionName to auto-create.' };
    }

    const action = this.#runner.game.getAction(pendingState.actionName);
    if (!action) {
      return { success: false, error: `Action not found: ${pendingState.actionName}` };
    }

    const executor = this.#runner.game.getActionExecutor();
    const player = this.#runner.game.players.get(playerPosition);
    const selection = action.selections[pendingState.currentSelectionIndex];

    if (!selection) {
      return { success: false, error: 'No current selection' };
    }

    // Verify we're processing the expected selection
    if (selection.name !== selectionName) {
      return { success: false, error: `Expected selection at index ${pendingState.currentSelectionIndex}, got ${selectionName} at index ${action.selections.findIndex(s => s.name === selectionName)}` };
    }

    // Check if it's a repeating selection
    if (executor.isRepeatingSelection(selection)) {
      const result = executor.processRepeatingStep(action, player, pendingState, value);

      if (result.error) {
        return { success: false, error: result.error, nextChoices: result.nextChoices };
      }

      // Persist if storage adapter is provided (onEach may have modified game state)
      if (this.#storage) {
        await this.#storage.save(this.#storedState);
      }

      // Broadcast state updates to all clients
      this.broadcast();

      // Check if the action is now complete
      if (result.done && executor.isPendingActionComplete(action, pendingState)) {
        // Execute the final action
        const actionResult = executor.executePendingAction(action, player, pendingState);
        this.#pendingActions.delete(playerPosition);

        if (actionResult.success) {
          // Continue the flow to update available actions
          this.#runner.game.continueFlowAfterPendingAction(actionResult);

          // Update stored action history
          this.#storedState.actionHistory = this.#runner.actionHistory;

          // Persist
          if (this.#storage) {
            await this.#storage.save(this.#storedState);
          }

          // Broadcast
          this.broadcast();

          // Check if AI should respond
          this.#scheduleAICheck();
        }

        return {
          success: actionResult.success,
          error: actionResult.error,
          done: true,
          actionComplete: true,
          actionResult: {
            success: actionResult.success,
            error: actionResult.error,
            flowState: this.#runner.getFlowState(),
            state: buildPlayerState(this.#runner, this.#storedState.playerNames, playerPosition, { includeActionMetadata: true, includeDebugData: true }),
          },
          state: buildPlayerState(this.#runner, this.#storedState.playerNames, playerPosition, { includeActionMetadata: true, includeDebugData: true }),
        };
      }

      // More selections needed
      return {
        success: true,
        done: result.done,
        nextChoices: result.nextChoices,
        actionComplete: false,
        state: buildPlayerState(this.#runner, this.#storedState.playerNames, playerPosition, { includeActionMetadata: true, includeDebugData: true }),
      };
    }

    // Regular (non-repeating) selection
    const stepResult = executor.processSelectionStep(action, player, pendingState, selectionName, value);

    if (!stepResult.success) {
      return { success: false, error: stepResult.error };
    }

    // Check if action is now complete
    if (executor.isPendingActionComplete(action, pendingState)) {
      const actionResult = executor.executePendingAction(action, player, pendingState);
      this.#pendingActions.delete(playerPosition);

      if (actionResult.success) {
        // Continue the flow to update available actions
        this.#runner.game.continueFlowAfterPendingAction(actionResult);

        // Update stored action history
        this.#storedState.actionHistory = this.#runner.actionHistory;

        // Persist
        if (this.#storage) {
          await this.#storage.save(this.#storedState);
        }

        // Broadcast
        this.broadcast();

        // Check if AI should respond
        this.#scheduleAICheck();
      }

      return {
        success: actionResult.success,
        error: actionResult.error,
        done: true,
        actionComplete: true,
        actionResult: {
          success: actionResult.success,
          error: actionResult.error,
          flowState: this.#runner.getFlowState(),
          state: buildPlayerState(this.#runner, this.#storedState.playerNames, playerPosition, { includeActionMetadata: true, includeDebugData: true }),
        },
        state: buildPlayerState(this.#runner, this.#storedState.playerNames, playerPosition, { includeActionMetadata: true, includeDebugData: true }),
      };
    }

    // More selections needed
    return {
      success: true,
      done: true,
      actionComplete: false,
      state: buildPlayerState(this.#runner, this.#storedState.playerNames, playerPosition, { includeActionMetadata: true, includeDebugData: true }),
    };
  }

  /**
   * Get the current pending action for a player.
   */
  getPendingAction(playerPosition: number): PendingActionState | undefined {
    return this.#pendingActions.get(playerPosition);
  }

  /**
   * Cancel a pending action for a player.
   */
  cancelPendingAction(playerPosition: number): void {
    this.#pendingActions.delete(playerPosition);
  }

  /**
   * Check if an action has repeating selections.
   */
  hasRepeatingSelections(actionName: string): boolean {
    const action = this.#runner.game.getAction(actionName);
    if (!action) return false;
    const executor = this.#runner.game.getActionExecutor();
    return executor.hasRepeatingSelections(action);
  }

  // ============================================
  // Broadcasting
  // ============================================

  /**
   * Broadcast current state to all connected sessions
   */
  broadcast(): void {
    if (!this.#broadcaster) return;

    const flowState = this.#runner.getFlowState();
    const sessions = this.#broadcaster.getSessions();

    for (const session of sessions) {
      const effectivePosition = session.isSpectator ? 0 : session.playerPosition;
      const state = buildPlayerState(this.#runner, this.#storedState.playerNames, effectivePosition, { includeActionMetadata: true, includeDebugData: true });

      const update: StateUpdate = {
        type: 'state',
        flowState,
        state,
        playerPosition: session.playerPosition,
        isSpectator: session.isSpectator,
      };

      try {
        this.#broadcaster.send(session, update);
      } catch (error) {
        console.error('Broadcast error:', error);
      }
    }
  }

  // ============================================
  // AI Integration
  // ============================================

  /**
   * Schedule an AI check (non-blocking)
   */
  #scheduleAICheck(): void {
    if (!this.#aiController?.hasAIPlayers()) return;

    // Use setImmediate/setTimeout to avoid blocking
    const schedule = typeof setImmediate !== 'undefined'
      ? setImmediate
      : (fn: () => void) => setTimeout(fn, 0);

    schedule(() => this.#checkAITurn());
  }

  /**
   * Check if AI should play and execute move
   */
  async #checkAITurn(): Promise<void> {
    if (!this.#aiController) return;

    const move = await this.#aiController.checkAndPlay(
      this.#runner,
      this.#storedState.actionHistory,
      async (action, player, args) => {
        const result = this.#runner.performAction(action, player, args);
        if (result.success) {
          this.#storedState.actionHistory = this.#runner.actionHistory;
          if (this.#storage) {
            await this.#storage.save(this.#storedState);
          }
          this.broadcast();
          return true;
        }
        return false;
      }
    );

    // If AI made a move, check again (might be multi-step or next AI player)
    if (move) {
      this.#scheduleAICheck();
    } else {
      // Even if no move was made (e.g., turn changed during delay, or blocked by #thinking),
      // we should still check if another AI player needs to act
      const flowState = this.#runner.getFlowState();
      if (flowState?.awaitingInput && !flowState.complete) {
        this.#scheduleAICheck();
      }
    }
  }

  // ============================================
  // Lobby Methods
  // ============================================

  /**
   * Check if the game is waiting for players to join
   */
  isWaitingForPlayers(): boolean {
    return this.#storedState.lobbyState === 'waiting';
  }

  /**
   * Get the current lobby state
   */
  getLobbyState(): LobbyState | undefined {
    return this.#storedState.lobbyState;
  }

  /**
   * Get full lobby information for clients
   */
  getLobbyInfo(): LobbyInfo | null {
    if (!this.#storedState.lobbySlots) {
      return null;
    }

    const slots = this.#storedState.lobbySlots;
    const openSlots = slots.filter(s => s.status === 'open').length;

    // All ready = no open slots AND all filled slots are ready (AI always ready)
    const allReady = openSlots === 0 &&
      slots.every(s => s.status === 'ai' || s.ready);

    return {
      state: this.#storedState.lobbyState ?? 'playing',
      gameType: this.#storedState.gameType,
      displayName: this.#displayName,
      slots,
      gameOptions: this.#storedState.gameOptions,
      gameOptionsDefinitions: this.#storedState.gameOptionsDefinitions,
      creatorId: this.#storedState.creatorId,
      openSlots,
      isReady: allReady,
      minPlayers: this.#storedState.minPlayers,
      maxPlayers: this.#storedState.maxPlayers,
    };
  }

  /**
   * Claim a position in the lobby
   *
   * @param position Position to claim (0-indexed)
   * @param playerId Player's unique ID
   * @param name Player's display name
   * @returns Result with updated lobby info
   */
  async claimPosition(
    position: number,
    playerId: string,
    name: string
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    // Position is 1-indexed, convert to array index
    const arrayIndex = position - 1;
    if (position < 1 || position > this.#storedState.lobbySlots.length) {
      return { success: false, error: 'Invalid position' };
    }

    const slot = this.#storedState.lobbySlots[arrayIndex];

    if (slot.status === 'ai') {
      return { success: false, error: 'This position is reserved for AI' };
    }

    if (slot.status === 'claimed' && slot.playerId !== playerId) {
      return { success: false, error: 'This position is already taken' };
    }

    // Check if player already claimed another position
    const existingSlot = this.#storedState.lobbySlots.find(
      s => s.playerId === playerId && s.position !== position
    );
    if (existingSlot) {
      // Release the old position
      existingSlot.status = 'open';
      existingSlot.playerId = undefined;
      existingSlot.name = `Player ${existingSlot.position}`;
      existingSlot.ready = false;
    }

    // Claim the position (starts not ready - player must explicitly ready up)
    slot.status = 'claimed';
    slot.playerId = playerId;
    slot.name = name;
    slot.ready = false;

    // Initialize player options with defaults (if definitions exist)
    if (this.#storedState.playerOptionsDefinitions) {
      slot.playerOptions = this.#computeDefaultPlayerOptions(position);
    }

    // Update player names in stored state (convert 1-indexed position to array index)
    this.#storedState.playerNames[position - 1] = name;

    // Note: Game no longer auto-starts when slots are filled
    // Players must use setReady() to ready up, and game starts when all are ready

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    // Note: Game doesn't auto-start from claimPosition anymore
    // Players must use setReady() after claiming their position

    return { success: true, lobby: this.getLobbyInfo()! };
  }

  /**
   * Update a player's name in their slot
   *
   * @param playerId Player's unique ID
   * @param name New display name
   */
  async updateSlotName(
    playerId: string,
    name: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    const slot = this.#storedState.lobbySlots.find(s => s.playerId === playerId);
    if (!slot) {
      return { success: false, error: 'Player not found in lobby' };
    }

    slot.name = name;
    // Convert 1-indexed position to array index
    this.#storedState.playerNames[slot.position - 1] = name;

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true };
  }

  /**
   * Set a player's ready state
   *
   * @param playerId Player's unique ID
   * @param ready Whether the player is ready
   * @returns Result with updated lobby info
   */
  async setReady(
    playerId: string,
    ready: boolean
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    const slot = this.#storedState.lobbySlots.find(s => s.playerId === playerId);
    if (!slot) {
      return { success: false, error: 'Player not found in lobby' };
    }

    if (slot.status === 'ai') {
      return { success: false, error: 'Cannot change ready state for AI' };
    }

    slot.ready = ready;

    // Check if all players are ready and start game
    await this.#checkAndStartGame();

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    // If game started, also broadcast initial game state
    const lobbyInfo = this.getLobbyInfo()!;
    if (lobbyInfo.state === 'playing') {
      this.broadcast();
    }

    return { success: true, lobby: lobbyInfo };
  }

  /**
   * Add a new player slot (host only)
   *
   * @param playerId Must be the creator's ID
   * @returns Result with updated lobby info
   */
  async addSlot(
    playerId: string
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    if (playerId !== this.#storedState.creatorId) {
      return { success: false, error: 'Only the host can add slots' };
    }

    const currentCount = this.#storedState.lobbySlots.length;
    const maxPlayers = this.#storedState.maxPlayers ?? 10;

    if (currentCount >= maxPlayers) {
      return { success: false, error: `Cannot exceed ${maxPlayers} players` };
    }

    const newPosition = currentCount + 1;  // 1-indexed
    this.#storedState.lobbySlots.push({
      position: newPosition,
      status: 'open',
      name: `Player ${newPosition}`,
      ready: false,
    });

    // Update player count and names
    this.#storedState.playerCount = currentCount + 1;
    this.#storedState.playerNames.push(`Player ${newPosition}`);

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo()! };
  }

  /**
   * Remove a player slot (host only, slot must be open or AI)
   *
   * @param playerId Must be the creator's ID
   * @param position Position of the slot to remove
   * @returns Result with updated lobby info
   */
  async removeSlot(
    playerId: string,
    position: number
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    if (playerId !== this.#storedState.creatorId) {
      return { success: false, error: 'Only the host can remove slots' };
    }

    const currentCount = this.#storedState.lobbySlots.length;
    const minPlayers = this.#storedState.minPlayers ?? 1;

    if (currentCount <= minPlayers) {
      return { success: false, error: `Cannot have fewer than ${minPlayers} players` };
    }

    // Position is 1-indexed
    if (position === 1) {
      return { success: false, error: 'Cannot remove the host slot' };
    }

    if (position < 1 || position > currentCount) {
      return { success: false, error: 'Invalid position' };
    }

    const arrayIndex = position - 1;
    const slot = this.#storedState.lobbySlots[arrayIndex];
    if (slot.status === 'claimed') {
      return { success: false, error: 'Cannot remove a slot with a player - they must leave first' };
    }

    // Remove the slot
    this.#storedState.lobbySlots.splice(arrayIndex, 1);
    this.#storedState.playerNames.splice(arrayIndex, 1);
    this.#storedState.playerCount = this.#storedState.lobbySlots.length;

    // Renumber remaining slots (1-indexed)
    this.#storedState.lobbySlots.forEach((s, i) => {
      s.position = i + 1; // 1-indexed
      if (s.status === 'open') {
        s.name = `Player ${i + 1}`;
      }
    });

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo()! };
  }

  /**
   * Toggle a slot between open and AI (host only)
   *
   * @param playerId Must be the creator's ID
   * @param position Position of the slot to modify
   * @param isAI Whether to make this an AI slot
   * @param aiLevel AI difficulty level (if isAI is true)
   * @returns Result with updated lobby info
   */
  async setSlotAI(
    playerId: string,
    position: number,
    isAI: boolean,
    aiLevel: string = 'medium'
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    if (playerId !== this.#storedState.creatorId) {
      return { success: false, error: 'Only the host can modify slots' };
    }

    // Position is 1-indexed
    if (position === 1) {
      return { success: false, error: 'Cannot change the host slot to AI' };
    }

    if (position < 1 || position > this.#storedState.lobbySlots.length) {
      return { success: false, error: 'Invalid position' };
    }

    const arrayIndex = position - 1;
    const slot = this.#storedState.lobbySlots[arrayIndex];

    if (slot.status === 'claimed') {
      return { success: false, error: 'Cannot change a claimed slot - player must leave first' };
    }

    if (isAI) {
      slot.status = 'ai';
      slot.name = 'Bot';
      slot.aiLevel = aiLevel;
      slot.playerId = undefined;
      slot.ready = true; // AI is always ready
    } else {
      slot.status = 'open';
      slot.name = `Player ${slot.position}`;
      slot.aiLevel = undefined;
      slot.playerId = undefined;
      slot.ready = false;
    }

    // Update AI config if needed
    this.#updateAIConfig();

    // Check if all players are ready and start game
    await this.#checkAndStartGame();

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    // If game started, also broadcast initial game state
    const lobbyInfo = this.getLobbyInfo()!;
    if (lobbyInfo.state === 'playing') {
      this.broadcast();
    }

    return { success: true, lobby: lobbyInfo };
  }

  /**
   * Check if all players are ready and start the game if so
   */
  async #checkAndStartGame(): Promise<void> {
    if (!this.#storedState.lobbySlots) return;
    if (this.#storedState.lobbyState !== 'waiting') return;

    const slots = this.#storedState.lobbySlots;
    const openSlots = slots.filter(s => s.status === 'open').length;

    // All ready = no open slots AND all humans are ready (AI is always ready)
    const allReady = openSlots === 0 &&
      slots.every(s => s.status === 'ai' || s.ready);

    if (allReady) {
      this.#storedState.lobbyState = 'playing';

      // Clear any pending disconnect timeouts since game is starting
      this.clearDisconnectTimeouts();

      // Trigger AI if needed
      if (this.#aiController?.hasAIPlayers()) {
        this.#scheduleAICheck();
      }
    }
  }

  /**
   * Update AI config based on current lobby slots
   */
  #updateAIConfig(): void {
    if (!this.#storedState.lobbySlots) return;

    const aiSlots = this.#storedState.lobbySlots.filter(s => s.status === 'ai');

    if (aiSlots.length === 0) {
      this.#storedState.aiConfig = undefined;
      this.#aiController = undefined;
    } else {
      const aiPlayers = aiSlots.map(s => s.position);
      const aiLevel = aiSlots[0].aiLevel || 'medium';

      this.#storedState.aiConfig = {
        players: aiPlayers,
        level: aiLevel as 'easy' | 'medium' | 'hard',
      };

      // Recreate AI controller with new config
      this.#aiController = new AIController(
        this.#GameClass,
        this.#storedState.gameType,
        this.#storedState.playerCount,
        this.#storedState.aiConfig
      );
    }
  }

  /**
   * Compute default player options for a position (static version)
   * Takes into account options already taken by other players
   */
  static computeDefaultPlayerOptions(
    position: number,
    definitions: Record<string, PlayerOptionDefinition>,
    lobbySlots: LobbySlot[],
    playerCount: number
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Collect values already taken by other players
    const takenValues: Record<string, Set<string>> = {};
    for (const slot of lobbySlots) {
      if (slot.position !== position && slot.playerOptions) {
        for (const [key, value] of Object.entries(slot.playerOptions)) {
          if (!takenValues[key]) {
            takenValues[key] = new Set();
          }
          takenValues[key].add(String(value));
        }
      }
    }

    for (const [key, opt] of Object.entries(definitions)) {
      if (opt.type === 'select' || opt.type === 'color') {
        // For select/color, pick the first available choice
        const choices = opt.choices ?? [];
        const taken = takenValues[key] ?? new Set();

        for (const choice of choices) {
          const value = typeof choice === 'string' ? choice : choice.value;
          if (!taken.has(value)) {
            result[key] = value;
            break;
          }
        }

        // If all choices are taken (shouldn't happen), use the default or first choice
        if (result[key] === undefined) {
          if (opt.default !== undefined) {
            result[key] = opt.default;
          } else if (choices.length > 0) {
            const firstChoice = choices[0];
            result[key] = typeof firstChoice === 'string' ? firstChoice : firstChoice.value;
          }
        }
      } else if (opt.type === 'exclusive') {
        // For exclusive options, check if this position matches the default
        let defaultIndex: number;
        if (opt.default === 'first' || opt.default === undefined) {
          defaultIndex = 0;
        } else if (opt.default === 'last') {
          defaultIndex = playerCount - 1;
        } else {
          defaultIndex = opt.default;
        }
        result[key] = position === defaultIndex;
      } else if (opt.type === 'text') {
        // For text, use the default if provided
        if (opt.default !== undefined) {
          result[key] = opt.default;
        }
      }
    }

    return result;
  }

  /**
   * Compute default player options for a position (instance method wrapper)
   */
  #computeDefaultPlayerOptions(position: number): Record<string, unknown> {
    const definitions = this.#storedState.playerOptionsDefinitions;
    if (!definitions || !this.#storedState.lobbySlots) return {};

    return GameSession.computeDefaultPlayerOptions(
      position,
      definitions,
      this.#storedState.lobbySlots,
      this.#storedState.playerCount
    );
  }

  /**
   * Get position for a player ID
   */
  getPositionForPlayer(playerId: string): number | undefined {
    if (!this.#storedState.lobbySlots) return undefined;
    const slot = this.#storedState.lobbySlots.find(s => s.playerId === playerId);
    return slot?.position;
  }

  /**
   * Broadcast lobby state to all connected sessions
   */
  broadcastLobby(): void {
    if (!this.#broadcaster) return;

    const lobby = this.getLobbyInfo();
    if (!lobby) return;

    const sessions = this.#broadcaster.getSessions();
    const update: LobbyUpdate = { type: 'lobby', lobby };

    for (const session of sessions) {
      try {
        this.#broadcaster.send(session, update);
      } catch (error) {
        console.error('Lobby broadcast error:', error);
      }
    }
  }

  /**
   * Set the connected status for a player in the lobby
   * Called when a WebSocket connects/disconnects
   *
   * @param playerId Player's unique ID
   * @param connected Whether the player is connected
   * @returns true if a slot was updated
   */
  /**
   * Leave/unclaim a position in the lobby
   * Used when a player leaves the waiting room
   */
  async leavePosition(playerId: string): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    console.log('[GameSession] leavePosition called with playerId:', playerId);
    console.log('[GameSession] lobbySlots:', JSON.stringify(this.#storedState.lobbySlots?.map(s => ({ pos: s.position, playerId: s.playerId, status: s.status }))));

    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    // Find the slot claimed by this player
    const slot = this.#storedState.lobbySlots.find(s => s.playerId === playerId);
    console.log('[GameSession] Found slot:', slot ? `position ${slot.position}` : 'none');
    if (!slot) {
      return { success: false, error: 'Player has not claimed a position' };
    }

    // Cannot leave if you're the creator/host (position 1)
    if (slot.position === 1) {
      return { success: false, error: 'Host cannot leave. Cancel the game instead.' };
    }

    // Release the position
    slot.status = 'open';
    slot.playerId = undefined;
    slot.name = `Player ${slot.position}`;
    slot.ready = false;
    slot.connected = undefined;

    // Update player names in stored state
    this.#storedState.playerNames[slot.position - 1] = slot.name;

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo() ?? undefined };
  }

  async setPlayerConnected(playerId: string, connected: boolean): Promise<boolean> {
    if (!this.#storedState.lobbySlots) return false;

    const slot = this.#storedState.lobbySlots.find(s => s.playerId === playerId);
    if (!slot) return false;

    // Handle disconnect timeout logic
    if (connected) {
      // Player reconnected - cancel any pending timeout
      const existingTimeout = this.#disconnectTimeouts.get(playerId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.#disconnectTimeouts.delete(playerId);
      }
    } else {
      // Player disconnected - unready them so game doesn't start without them
      if (slot.ready && this.#storedState.lobbyState === 'waiting') {
        slot.ready = false;
      }

      // Start timeout for auto-kick (non-host players only)
      if (slot.position !== 1 && this.#storedState.lobbyState === 'waiting') {
        // Clear any existing timeout first
        const existingTimeout = this.#disconnectTimeouts.get(playerId);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }

        const timeout = setTimeout(async () => {
          this.#disconnectTimeouts.delete(playerId);
          // Auto-kick if still in waiting state
          if (this.#storedState.lobbyState === 'waiting') {
            await this.leavePosition(playerId);
          }
        }, GameSession.DISCONNECT_TIMEOUT_MS);

        this.#disconnectTimeouts.set(playerId, timeout);
      }
    }

    // Only update if status actually changed
    if (slot.connected === connected) return false;

    slot.connected = connected;

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return true;
  }

  /**
   * Kick a player from the lobby (host only)
   *
   * @param hostPlayerId Must be the creator's ID
   * @param position Position of the player to kick
   * @returns Result with updated lobby info
   */
  async kickPlayer(
    hostPlayerId: string,
    position: number
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    // Verify caller is the host
    if (hostPlayerId !== this.#storedState.creatorId) {
      return { success: false, error: 'Only the host can kick players' };
    }

    // Position is 1-indexed. Can't kick yourself (host is position 1)
    if (position === 1) {
      return { success: false, error: 'Cannot kick the host' };
    }

    if (position < 1 || position > this.#storedState.lobbySlots.length) {
      return { success: false, error: 'Invalid position' };
    }

    const arrayIndex = position - 1;
    const slot = this.#storedState.lobbySlots[arrayIndex];

    if (slot.status !== 'claimed') {
      return { success: false, error: 'Position is not occupied by a player' };
    }

    // Clear any pending disconnect timeout for this player
    if (slot.playerId) {
      const timeout = this.#disconnectTimeouts.get(slot.playerId);
      if (timeout) {
        clearTimeout(timeout);
        this.#disconnectTimeouts.delete(slot.playerId);
      }
    }

    // Release the slot
    slot.status = 'open';
    slot.playerId = undefined;
    slot.name = `Player ${slot.position}`;
    slot.ready = false;
    slot.connected = undefined;

    // Update player names in stored state
    this.#storedState.playerNames[slot.position - 1] = slot.name;

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo() ?? undefined };
  }

  /**
   * Clear all disconnect timeouts (e.g., when game starts or ends)
   */
  clearDisconnectTimeouts(): void {
    for (const timeout of this.#disconnectTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.#disconnectTimeouts.clear();
  }

  /**
   * Update a player's options (color, etc.)
   *
   * @param playerId Player's unique ID
   * @param options The player options to set
   * @returns Result with updated lobby info
   */
  async updatePlayerOptions(
    playerId: string,
    options: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    const slot = this.#storedState.lobbySlots.find(s => s.playerId === playerId);
    if (!slot) {
      return { success: false, error: 'Player not found in lobby' };
    }

    // Merge new options with existing
    slot.playerOptions = {
      ...slot.playerOptions,
      ...options,
    };

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo() ?? undefined };
  }

  /**
   * Update a specific slot's player options (host only)
   * Used for exclusive options that the host assigns to players
   *
   * @param hostPlayerId Must be the creator's ID
   * @param position The slot position to update
   * @param options The player options to set
   * @returns Result with updated lobby info
   */
  async updateSlotPlayerOptions(
    hostPlayerId: string,
    position: number,
    options: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    // Verify caller is the host
    if (hostPlayerId !== this.#storedState.creatorId) {
      return { success: false, error: 'Only the host can modify other players\' options' };
    }

    const slot = this.#storedState.lobbySlots.find(s => s.position === position);
    if (!slot) {
      return { success: false, error: 'Slot not found' };
    }

    if (slot.status === 'open') {
      return { success: false, error: 'Cannot set options for an open slot' };
    }

    // Merge new options with existing
    slot.playerOptions = {
      ...slot.playerOptions,
      ...options,
    };

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo() ?? undefined };
  }

  /**
   * Update game options (host only)
   *
   * @param hostPlayerId Must be the creator's ID
   * @param options The game options to set
   * @returns Result with updated lobby info
   */
  async updateGameOptions(
    hostPlayerId: string,
    options: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#storedState.lobbySlots) {
      return { success: false, error: 'Game does not have a lobby' };
    }

    if (this.#storedState.lobbyState !== 'waiting') {
      return { success: false, error: 'Game has already started' };
    }

    // Verify caller is the host
    if (hostPlayerId !== this.#storedState.creatorId) {
      return { success: false, error: 'Only the host can modify game options' };
    }

    // Merge new options with existing
    this.#storedState.gameOptions = {
      ...this.#storedState.gameOptions,
      ...options,
    };

    // Persist changes
    if (this.#storage) {
      await this.#storage.save(this.#storedState);
    }

    // Broadcast lobby update
    this.broadcastLobby();

    return { success: true, lobby: this.getLobbyInfo() ?? undefined };
  }
}
