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
import { buildPlayerState } from './utils.js';
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
  readonly #runner: GameRunner<G>;
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
    } = options;

    const gameSeed = seed ?? Math.random().toString(36).substring(2) + Date.now().toString(36);

    const runner = new GameRunner<G>({
      GameClass,
      gameType,
      gameOptions: { playerCount, playerNames, seed: gameSeed },
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
    }
  }
}
