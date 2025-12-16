/**
 * Core GameSession class for managing game state and lifecycle
 */

import type { FlowState, SerializedAction, Game } from '@boardsmith/engine';
import { GameRunner } from '@boardsmith/runtime';
import type {
  GameClass,
  StoredGameState,
  PlayerGameState,
  SessionInfo,
  StateUpdate,
  StorageAdapter,
  BroadcastAdapter,
  AIConfig,
} from './types.js';
import { buildPlayerState, computeUndoInfo } from './utils.js';
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
}

/**
 * Result of performing an action
 */
export interface ActionResult {
  success: boolean;
  error?: string;
  flowState?: FlowState;
  state?: PlayerGameState;
  serializedAction?: SerializedAction;
}

/**
 * Result of undoing actions
 */
export interface UndoResult {
  success: boolean;
  error?: string;
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
  #runner: GameRunner<G>;
  readonly #storedState: StoredGameState;
  readonly #GameClass: GameClass<G>;
  readonly #storage?: StorageAdapter;
  readonly #aiController?: AIController<G>;
  #broadcaster?: BroadcastAdapter<TSession>;

  private constructor(
    runner: GameRunner<G>,
    storedState: StoredGameState,
    GameClass: GameClass<G>,
    storage?: StorageAdapter,
    aiController?: AIController<G>
  ) {
    this.#runner = runner;
    this.#storedState = storedState;
    this.#GameClass = GameClass;
    this.#storage = storage;
    this.#aiController = aiController;
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
    } = options;

    const gameSeed = seed ?? Math.random().toString(36).substring(2) + Date.now().toString(36);

    const runner = new GameRunner<G>({
      GameClass,
      gameType,
      gameOptions: { playerCount, playerNames, seed: gameSeed, ...customGameOptions },
    });

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
    };

    runner.start();

    const aiController = aiConfig
      ? new AIController(GameClass, gameType, playerCount, aiConfig)
      : undefined;

    const session = new GameSession(runner, storedState, GameClass, storage, aiController);

    // Trigger AI if it should move first
    if (aiController?.hasAIPlayers()) {
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
   */
  getState(
    playerPosition: number,
    options?: { includeActionMetadata?: boolean }
  ): { success: boolean; flowState?: FlowState; state?: PlayerGameState } {
    const flowState = this.#runner.getFlowState();
    const state = buildPlayerState(
      this.#runner,
      this.#storedState.playerNames,
      playerPosition,
      { includeActionMetadata: options?.includeActionMetadata ?? true }
    );
    return { success: true, flowState, state };
  }

  /**
   * Build player state for a specific position
   */
  buildPlayerState(playerPosition: number, options?: { includeActionMetadata?: boolean }): PlayerGameState {
    return buildPlayerState(
      this.#runner,
      this.#storedState.playerNames,
      playerPosition,
      { includeActionMetadata: options?.includeActionMetadata ?? true }
    );
  }

  /**
   * Update a player's name
   * @param position Player position (0-indexed)
   * @param name New name for the player
   */
  updatePlayerName(position: number, name: string): void {
    if (position < 0 || position >= this.#storedState.playerCount) {
      throw new Error(`Invalid player position: ${position}`);
    }
    this.#storedState.playerNames[position] = name;

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
    if (player < 0 || player >= this.#storedState.playerCount) {
      return { success: false, error: `Invalid player: ${player}` };
    }

    const result = this.#runner.performAction(action, player, args);

    if (!result.success) {
      return { success: false, error: result.error };
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

    return {
      success: true,
      flowState: result.flowState,
      state: buildPlayerState(this.#runner, this.#storedState.playerNames, player, { includeActionMetadata: true }),
      serializedAction: result.serializedAction,
    };
  }

  /**
   * Undo actions back to the start of the current player's turn.
   * Only works if it's the player's turn and they've made at least one action.
   */
  async undoToTurnStart(playerPosition: number): Promise<UndoResult> {
    // Validate player position
    if (playerPosition < 0 || playerPosition >= this.#storedState.playerCount) {
      return { success: false, error: `Invalid player: ${playerPosition}` };
    }

    // Check if it's this player's turn
    const flowState = this.#runner.getFlowState();
    if (flowState?.currentPlayer !== playerPosition) {
      return { success: false, error: "It's not your turn" };
    }

    // Compute where the turn started
    const { turnStartActionIndex, actionsThisTurn } = computeUndoInfo(
      this.#storedState.actionHistory,
      flowState.currentPlayer
    );

    // Check if there's anything to undo
    if (actionsThisTurn === 0) {
      return { success: false, error: 'No actions to undo' };
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
        state: buildPlayerState(this.#runner, this.#storedState.playerNames, playerPosition, { includeActionMetadata: true }),
        actionsUndone: actionsThisTurn,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to undo',
      };
    }
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
      const state = buildPlayerState(this.#runner, this.#storedState.playerNames, effectivePosition, { includeActionMetadata: true });

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
}
