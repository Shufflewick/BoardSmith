/**
 * Core GameSession class for managing game state and lifecycle
 */

import type { FlowState, SerializedAction, Game, PendingActionState, GameCommand } from '@boardsmith/engine';
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
import { buildPlayerState, buildSingleActionMetadata } from './utils.js';
import { AIController } from './ai-controller.js';
import { LobbyManager } from './lobby-manager.js';
import { SelectionHandler } from './selection-handler.js';
import { PendingActionManager } from './pending-action-manager.js';
import { StateHistory, type UndoResult, type ElementDiff } from './state-history.js';
import { DebugController } from './debug-controller.js';

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

// UndoResult and ElementDiff are now exported from state-history.ts
export type { UndoResult, ElementDiff } from './state-history.js';

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
  #GameClass: GameClass<G>;
  readonly #storage?: StorageAdapter;
  #aiController?: AIController<G>;  // Mutable for dynamic AI slot changes
  #broadcaster?: BroadcastAdapter<TSession>;
  #displayName?: string;
  /** Lobby manager for games with lobby flow */
  #lobbyManager?: LobbyManager<TSession>;
  /** Selection handler for resolving selection choices */
  #selectionHandler: SelectionHandler<G>;
  /** Pending action manager for repeating selections */
  #pendingActionManager: PendingActionManager<G>;
  /** State history for time travel and undo */
  #stateHistory: StateHistory<G>;
  /** Debug controller for deck manipulation */
  #debugController: DebugController<G>;

  private constructor(
    runner: GameRunner<G>,
    storedState: StoredGameState,
    GameClass: GameClass<G>,
    storage?: StorageAdapter,
    aiController?: AIController<G>,
    displayName?: string,
    lobbyManager?: LobbyManager<TSession>,
    selectionHandler?: SelectionHandler<G>,
    pendingActionManager?: PendingActionManager<G>
  ) {
    this.#runner = runner;
    this.#storedState = storedState;
    this.#GameClass = GameClass;
    this.#storage = storage;
    this.#aiController = aiController;
    this.#displayName = displayName;
    this.#lobbyManager = lobbyManager;

    // Initialize handlers - create them if not provided (for backward compatibility during construction)
    // The factory methods will create and pass these in
    this.#selectionHandler = selectionHandler ?? new SelectionHandler(runner, storedState.playerCount);
    this.#pendingActionManager = pendingActionManager ?? new PendingActionManager(
      runner,
      storedState,
      storage,
      {
        save: async () => {
          if (this.#storage) {
            await this.#storage.save(this.#storedState);
          }
        },
        broadcast: () => this.broadcast(),
        scheduleAICheck: () => this.#scheduleAICheck(),
      }
    );

    // Initialize state history and debug controller
    this.#stateHistory = new StateHistory(
      GameClass,
      storedState,
      () => this.#runner,
      {
        replaceRunner: (newRunner) => {
          this.#runner = newRunner;
          // Update handlers with new runner reference
          this.#selectionHandler = this.#selectionHandler.updateRunner(newRunner);
          this.#pendingActionManager.updateRunner(newRunner);
        },
        save: async () => {
          if (this.#storage) {
            await this.#storage.save(this.#storedState);
          }
        },
        broadcast: () => this.broadcast(),
      }
    );
    this.#debugController = new DebugController(
      () => this.#runner,
      {
        broadcast: () => this.broadcast(),
      }
    );
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

    // Create lobby manager if using lobby flow
    let lobbyManager: LobbyManager | undefined;
    if (useLobby && lobbySlots) {
      // Create a temporary session ref for the callbacks (will be replaced after construction)
      const callbacks = {
        onGameStart: () => {
          // Trigger AI check when game starts
          if (session.#aiController?.hasAIPlayers()) {
            session.#scheduleAICheck();
          }
        },
        onAIConfigChanged: (aiSlots: LobbySlot[]) => {
          if (aiSlots.length === 0) {
            storedState.aiConfig = undefined;
            session.#aiController = undefined;
          } else {
            const aiPlayers = aiSlots.map(s => s.position);
            const aiLevel = aiSlots[0].aiLevel || 'medium';
            storedState.aiConfig = {
              players: aiPlayers,
              level: aiLevel as 'easy' | 'medium' | 'hard',
            };
            session.#aiController = new AIController(
              GameClass,
              gameType,
              playerCount,
              storedState.aiConfig
            );
          }
        },
      };
      lobbyManager = new LobbyManager(storedState, storage, callbacks, displayName);
    }

    const session = new GameSession(runner, storedState, GameClass, storage, aiController, displayName, lobbyManager);

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

    // Create lobby manager if stored state has lobby slots
    let lobbyManager: LobbyManager | undefined;
    if (storedState.lobbySlots) {
      // Need session reference for callbacks, will be set after construction
      const callbacks = {
        onGameStart: () => {
          // Trigger AI check when game starts
          if (session.#aiController?.hasAIPlayers()) {
            session.#scheduleAICheck();
          }
        },
        onAIConfigChanged: (aiSlots: LobbySlot[]) => {
          if (aiSlots.length === 0) {
            storedState.aiConfig = undefined;
            session.#aiController = undefined;
          } else {
            const aiPlayers = aiSlots.map(s => s.position);
            const aiLevel = aiSlots[0].aiLevel || 'medium';
            storedState.aiConfig = {
              players: aiPlayers,
              level: aiLevel as 'easy' | 'medium' | 'hard',
            };
            session.#aiController = new AIController(
              GameClass,
              storedState.gameType,
              storedState.playerCount,
              storedState.aiConfig
            );
          }
        },
      };
      lobbyManager = new LobbyManager(storedState, storage, callbacks);
    }

    const session = new GameSession(runner, storedState, GameClass, storage, aiController, undefined, lobbyManager);
    return session;
  }

  // ============================================
  // Accessors
  // ============================================

  /**
   * Set the broadcast adapter for real-time updates
   */
  setBroadcaster(broadcaster: BroadcastAdapter<TSession>): void {
    this.#broadcaster = broadcaster;
    this.#lobbyManager?.setBroadcaster(broadcaster);
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
    return this.#stateHistory.getStateAtAction(actionIndex, playerPosition);
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
    return this.#stateHistory.getStateDiff(fromIndex, toIndex, playerPosition);
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
    return this.#stateHistory.getActionTraces(playerPosition);
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

    // Update handlers with new runner reference
    this.#selectionHandler = this.#selectionHandler.updateRunner(newRunner);
    this.#pendingActionManager.updateRunner(newRunner);

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
    return this.#stateHistory.undoToTurnStart(playerPosition);
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
    return this.#stateHistory.rewindToAction(targetActionIndex);
  }

  // ============================================
  // Debug Deck Manipulation Methods (delegated to DebugController)
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
    return this.#debugController.executeDebugCommand(command);
  }

  /**
   * Move a card to the top of its current deck (debug only).
   * The card remains in the same parent but is moved to position 0.
   *
   * @param cardId ID of the card to move
   * @returns Result with success status
   */
  moveCardToTop(cardId: number): { success: boolean; error?: string } {
    return this.#debugController.moveCardToTop(cardId);
  }

  /**
   * Move a card to a specific position within its current deck (debug only).
   *
   * @param cardId ID of the card to move
   * @param targetIndex Target position (0-based)
   * @returns Result with success status
   */
  reorderCard(cardId: number, targetIndex: number): { success: boolean; error?: string } {
    return this.#debugController.reorderCard(cardId, targetIndex);
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
    return this.#debugController.transferCard(cardId, targetDeckId, position);
  }

  /**
   * Shuffle a deck (debug only).
   *
   * @param deckId ID of the deck to shuffle
   * @returns Result with success status
   */
  shuffleDeck(deckId: number): { success: boolean; error?: string } {
    return this.#debugController.shuffleDeck(deckId);
  }

  // ============================================
  // Selection Choices Methods (delegated to SelectionHandler)
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
    return this.#selectionHandler.getSelectionChoices(actionName, selectionName, playerPosition, currentArgs);
  }

  // ============================================
  // Pending Action Methods (delegated to PendingActionManager)
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
    return this.#pendingActionManager.startPendingAction(actionName, playerPosition);
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
    return this.#pendingActionManager.processSelectionStep(playerPosition, selectionName, value, actionName, initialArgs);
  }

  /**
   * Get the current pending action for a player.
   */
  getPendingAction(playerPosition: number): PendingActionState | undefined {
    return this.#pendingActionManager.getPendingAction(playerPosition);
  }

  /**
   * Cancel a pending action for a player.
   */
  cancelPendingAction(playerPosition: number): void {
    this.#pendingActionManager.cancelPendingAction(playerPosition);
  }

  /**
   * Check if an action has repeating selections.
   */
  hasRepeatingSelections(actionName: string): boolean {
    return this.#pendingActionManager.hasRepeatingSelections(actionName);
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
  // Lobby Methods (delegated to LobbyManager)
  // ============================================

  /**
   * Check if the game is waiting for players to join
   */
  isWaitingForPlayers(): boolean {
    return this.#lobbyManager?.isWaitingForPlayers() ?? false;
  }

  /**
   * Get the current lobby state
   */
  getLobbyState(): LobbyState | undefined {
    return this.#lobbyManager?.getLobbyState();
  }

  /**
   * Get full lobby information for clients
   */
  getLobbyInfo(): LobbyInfo | null {
    return this.#lobbyManager?.getLobbyInfo() ?? null;
  }

  /**
   * Claim a position in the lobby
   *
   * @param position Position to claim (1-indexed)
   * @param playerId Player's unique ID
   * @param name Player's display name
   * @returns Result with updated lobby info
   */
  async claimPosition(
    position: number,
    playerId: string,
    name: string
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    return this.#lobbyManager.claimPosition(position, playerId, name);
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
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    return this.#lobbyManager.updateSlotName(playerId, name);
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
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    const result = await this.#lobbyManager.setReady(playerId, ready);
    // If game started, also broadcast initial game state
    if (result.success && result.gameStarted) {
      this.broadcast();
    }
    return result;
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
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    return this.#lobbyManager.addSlot(playerId);
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
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    return this.#lobbyManager.removeSlot(playerId, position);
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
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    const result = await this.#lobbyManager.setSlotAI(playerId, position, isAI, aiLevel);
    // If game started, also broadcast initial game state
    if (result.success && result.gameStarted) {
      this.broadcast();
    }
    return result;
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
    return LobbyManager.computeDefaultPlayerOptions(position, definitions, lobbySlots, playerCount);
  }

  /**
   * Get position for a player ID
   */
  getPositionForPlayer(playerId: string): number | undefined {
    return this.#lobbyManager?.getPositionForPlayer(playerId);
  }

  /**
   * Broadcast lobby state to all connected sessions
   */
  broadcastLobby(): void {
    this.#lobbyManager?.broadcastLobby();
  }

  /**
   * Leave/unclaim a position in the lobby
   * Used when a player leaves the waiting room
   */
  async leavePosition(playerId: string): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    return this.#lobbyManager.leavePosition(playerId);
  }

  /**
   * Set the connected status for a player in the lobby
   * Called when a WebSocket connects/disconnects
   *
   * @param playerId Player's unique ID
   * @param connected Whether the player is connected
   * @returns true if a slot was updated
   */
  async setPlayerConnected(playerId: string, connected: boolean): Promise<boolean> {
    return this.#lobbyManager?.setPlayerConnected(playerId, connected) ?? false;
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
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    return this.#lobbyManager.kickPlayer(hostPlayerId, position);
  }

  /**
   * Clear all disconnect timeouts (e.g., when game starts or ends)
   */
  clearDisconnectTimeouts(): void {
    this.#lobbyManager?.clearDisconnectTimeouts();
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
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    return this.#lobbyManager.updatePlayerOptions(playerId, options);
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
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    return this.#lobbyManager.updateSlotPlayerOptions(hostPlayerId, position, options);
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
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    return this.#lobbyManager.updateGameOptions(hostPlayerId, options);
  }
}
