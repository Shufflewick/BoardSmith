/**
 * GameSession - Unified game session management across platforms.
 *
 * Architecture: GameSession delegates to focused helper classes:
 * - LobbyManager: Player slots, ready state, game start
 * - SelectionHandler: Action selection choice resolution
 * - PendingActionManager: Repeating selection state machine
 * - StateHistory: Time travel, undo, action traces
 * - DebugController: Debug deck manipulation
 *
 * This keeps GameSession focused on core concerns:
 * - Game lifecycle (create, restore)
 * - Action execution
 * - State queries
 * - Broadcasting
 * - AI scheduling
 */

import type { FlowState, SerializedAction, Game, PendingActionState, GameCommand, DevSnapshot, DevValidationResult, DevCheckpoint } from '../engine/index.js';
import { captureDevState, restoreDevState, validateDevSnapshot, formatValidationErrors, getSnapshotElementCount } from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
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
  type PickChoicesResponse,
} from './types.js';
import { buildPlayerState, buildSingleActionMetadata } from './utils.js';
import { AIController } from './ai-controller.js';
import type { AIConfig as BotAIConfig } from '../ai/index.js';
import { LobbyManager } from './lobby-manager.js';
import { PickHandler } from './pick-handler.js';
import { PendingActionManager } from './pending-action-manager.js';
import { StateHistory, type UndoResult, type ElementDiff } from './state-history.js';
import { DebugController } from './debug-controller.js';
import { CheckpointManager } from './checkpoint-manager.js';

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
  /** AI configuration (objectives and threat response hooks) from game definition */
  botAIConfig?: BotAIConfig;
  /** Minimum number of players allowed (for lobby slot management) */
  minPlayers?: number;
  /** Maximum number of players allowed (for lobby slot management) */
  maxPlayers?: number;
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
  /** Pick handler for resolving pick choices */
  #pickHandler: PickHandler<G>;
  /** Pending action manager for repeating selections */
  #pendingActionManager: PendingActionManager<G>;
  /** State history for time travel and undo */
  #stateHistory: StateHistory<G>;
  /** Debug controller for deck manipulation */
  #debugController: DebugController<G>;
  /** Checkpoint manager for fast HMR recovery (dev only) */
  #checkpointManager?: CheckpointManager<G>;
  /** Circuit breaker: consecutive AI failures before giving up */
  #aiConsecutiveFailures = 0;

  private constructor(
    runner: GameRunner<G>,
    storedState: StoredGameState,
    GameClass: GameClass<G>,
    storage?: StorageAdapter,
    aiController?: AIController<G>,
    displayName?: string,
    lobbyManager?: LobbyManager<TSession>,
    pickHandler?: PickHandler<G>,
    pendingActionManager?: PendingActionManager<G>
  ) {
    this.#runner = runner;
    this.#storedState = storedState;
    this.#GameClass = GameClass;
    this.#storage = storage;
    this.#aiController = aiController;
    this.#displayName = displayName;
    this.#lobbyManager = lobbyManager;

    // Initialize handlers - create them if not provided
    // The factory methods will create and pass these in
    this.#pickHandler = pickHandler ?? new PickHandler(runner, storedState.playerCount);
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
          this.#pickHandler = this.#pickHandler.updateRunner(newRunner);
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

    // Initialize checkpoint manager in dev mode only
    if (process.env.NODE_ENV !== 'production') {
      this.#checkpointManager = new CheckpointManager<G>();
    }
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
      botAIConfig,
      minPlayers,
      maxPlayers,
    } = options;

    const gameSeed = seed ?? Math.random().toString(36).substring(2) + Date.now().toString(36);

    // Extract color palette from playerOptionsDefinitions if game designer defined one
    // This ensures the engine uses the game's custom colors (e.g., CHECKERS_COLORS)
    // instead of falling back to DEFAULT_COLOR_PALETTE
    let extractedColors: string[] | undefined;
    if (playerOptionsDefinitions?.color && !customGameOptions?.colors) {
      const colorDef = playerOptionsDefinitions.color;
      if ('choices' in colorDef && colorDef.choices && colorDef.choices.length > 0) {
        extractedColors = colorDef.choices.map(
          (c: string | { value: string }) => typeof c === 'string' ? c : c.value
        );
      }
    }
    const effectiveGameOptions = {
      playerCount,
      playerNames,
      seed: gameSeed,
      ...customGameOptions,
      ...(extractedColors ? { colors: extractedColors } : {}),
    };

    const runner = new GameRunner<G>({
      GameClass,
      gameType,
      gameOptions: effectiveGameOptions,
    });

    // Build lobby slots from player configs
    let lobbySlots: LobbySlot[] | undefined;
    let lobbyState: LobbyState | undefined;

    if (useLobby && playerConfigs) {
      lobbySlots = playerConfigs.map((config, i) => {
        const isAI = config.isAI ?? false;
        const seat = i + 1; // 1-indexed seats
        const isCreator = seat === 1; // Seat 1 is always the creator

        // Extract player options (everything except name, isAI, aiLevel)
        const playerOptions: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(config)) {
          if (!['name', 'isAI', 'aiLevel'].includes(key)) {
            playerOptions[key] = value;
          }
        }

        return {
          seat,
          status: isAI ? 'ai' : (isCreator ? 'claimed' : 'open'),
          name: config.name ?? (isAI ? 'Bot' : `Player ${seat}`),
          playerId: isCreator ? creatorId : undefined,
          aiLevel: isAI ? (config.aiLevel ?? 'medium') : undefined,
          playerOptions: Object.keys(playerOptions).length > 0 ? playerOptions : undefined,
          // AI is always ready, humans start not ready
          ready: isAI ? true : false,
        } as LobbySlot;
      });

      // Initialize default player options for the host (seat 1)
      // Merge with existing preset options so preset values (e.g., color from preset config) take precedence
      if (playerOptionsDefinitions && lobbySlots[0]?.status === 'claimed') {
        const defaults = GameSession.computeDefaultPlayerOptions(
          1,
          playerOptionsDefinitions,
          lobbySlots,
          playerCount
        );
        lobbySlots[0].playerOptions = { ...defaults, ...lobbySlots[0].playerOptions };
      }

      // Always start in 'waiting' state when using lobby
      // Game only starts when all players click Ready
      lobbyState = 'waiting';
    }

    runner.start();

    // Extract color settings from the game instance after creation
    const colorSelectionEnabled = runner.game.settings.colorSelectionEnabled as boolean | undefined;
    const colors = runner.game.settings.colors as string[] | undefined;

    // Initialize default colors for all non-open slots
    // This ensures host and pre-configured AI slots have colors from the start
    // Track already-assigned colors to avoid duplicates
    if (colorSelectionEnabled && colors && lobbySlots) {
      const takenColors = new Set<string>();

      // First pass: collect colors already assigned (e.g., from presets)
      for (const slot of lobbySlots) {
        if (slot.playerOptions?.color) {
          takenColors.add(slot.playerOptions.color as string);
        }
      }

      // Second pass: assign colors to slots that don't have one yet
      for (const slot of lobbySlots) {
        if (slot.status !== 'open' && !slot.playerOptions?.color) {
          // Find first available color not already taken
          const availableColor = colors.find(c => !takenColors.has(c));
          if (availableColor) {
            slot.playerOptions = { ...slot.playerOptions, color: availableColor };
            takenColors.add(availableColor);
          }
        }
      }
    }

    // For non-lobby games (e.g., --ai mode), apply default colors directly to players.
    // Lobby games apply colors later via the onGameStart callback.
    if (!useLobby && colorSelectionEnabled && colors) {
      for (let i = 0; i < playerCount; i++) {
        const player = runner.game.getPlayer(i + 1);
        if (player && !player.color) {
          player.color = colors[i % colors.length];
        }
      }
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
      colorSelectionEnabled,
      colors,
      minPlayers,
      maxPlayers,
    };

    const aiController = aiConfig
      ? new AIController(GameClass, gameType, playerCount, aiConfig, botAIConfig)
      : undefined;

    // Create lobby manager if using lobby flow
    let lobbyManager: LobbyManager | undefined;
    if (useLobby && lobbySlots) {
      // Create a temporary session ref for the callbacks (will be replaced after construction)
      const callbacks = {
        onGameStart: () => {
          // Build playerConfigs from lobby slots for game constructor access
          // This allows games to access player options via options.playerConfigs[seat-1]
          const playerConfigs = storedState.lobbySlots?.map(slot => ({
            name: slot.name,
            isAI: slot.status === 'ai',
            aiLevel: slot.aiLevel,
            ...slot.playerOptions,
          }));

          // Check if player count changed in lobby (host added/removed players)
          const currentSlotCount = storedState.lobbySlots?.length ?? 0;
          const enginePlayerCount = session.#runner.game.players.length;

          // Always recreate the game to pass playerConfigs from lobby
          // The game needs access to playerConfigs for per-player options like isDictator
          if (storedState.lobbySlots) {
            const newPlayerNames = storedState.lobbySlots.map(s => s.name);
            const newGameOptions = {
              playerCount: currentSlotCount,
              playerNames: newPlayerNames,
              seed: storedState.seed,
              ...storedState.gameOptions,
              ...(storedState.colors ? { colors: storedState.colors } : {}),
              playerConfigs,
            };

            const newRunner = new GameRunner<G>({
              GameClass,
              gameType,
              gameOptions: newGameOptions,
            });
            newRunner.start();

            // Replace the session's runner
            session.#runner = newRunner;
            session.#pickHandler = session.#pickHandler.updateRunner(newRunner);
            session.#pendingActionManager.updateRunner(newRunner);

            // Update storedState to reflect actual counts
            storedState.playerCount = currentSlotCount;
            storedState.playerNames = newPlayerNames;
          }

          // Apply player names and colors from lobby selections
          // Players may have changed names or selected different colors than the auto-assigned ones
          if (storedState.lobbySlots) {
            for (const slot of storedState.lobbySlots) {
              const player = session.#runner.game.getPlayer(slot.seat);
              if (player) {
                // Sync player name from lobby slot
                if (slot.name && player.name !== slot.name) {
                  player.name = slot.name;
                }
                // Sync player color from lobby slot
                const selectedColor = slot.playerOptions?.color as string | undefined;
                if (selectedColor) {
                  player.color = selectedColor;
                }
              }
            }
          }

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
            const aiPlayers = aiSlots.map(s => s.seat);
            const aiLevel = aiSlots[0].aiLevel || 'medium';
            storedState.aiConfig = {
              players: aiPlayers,
              level: aiLevel as 'easy' | 'medium' | 'hard',
            };
            session.#aiController = new AIController(
              GameClass,
              gameType,
              storedState.playerCount,
              storedState.aiConfig,
              botAIConfig
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
    storage?: StorageAdapter,
    botAIConfig?: BotAIConfig
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
      ? new AIController(GameClass, storedState.gameType, storedState.playerCount, storedState.aiConfig, botAIConfig)
      : undefined;

    // Create lobby manager if stored state has lobby slots
    let lobbyManager: LobbyManager | undefined;
    if (storedState.lobbySlots) {
      // Need session reference for callbacks, will be set after construction
      const callbacks = {
        onGameStart: () => {
          // Build playerConfigs from lobby slots for game constructor access
          // This allows games to access player options via options.playerConfigs[seat-1]
          const playerConfigs = storedState.lobbySlots?.map(slot => ({
            name: slot.name,
            isAI: slot.status === 'ai',
            aiLevel: slot.aiLevel,
            ...slot.playerOptions,
          }));

          // Check if player count changed in lobby (host added/removed players)
          const currentSlotCount = storedState.lobbySlots?.length ?? 0;
          const enginePlayerCount = session.#runner.game.players.length;

          // Always recreate the game to pass playerConfigs from lobby
          // The game needs access to playerConfigs for per-player options like isDictator
          if (storedState.lobbySlots) {
            const newPlayerNames = storedState.lobbySlots.map(s => s.name);
            const newGameOptions = {
              playerCount: currentSlotCount,
              playerNames: newPlayerNames,
              seed: storedState.seed,
              ...storedState.gameOptions,
              ...(storedState.colors ? { colors: storedState.colors } : {}),
              playerConfigs,
            };

            const newRunner = new GameRunner<G>({
              GameClass,
              gameType: storedState.gameType,
              gameOptions: newGameOptions,
            });
            newRunner.start();

            // Replace the session's runner
            session.#runner = newRunner;
            session.#pickHandler = session.#pickHandler.updateRunner(newRunner);
            session.#pendingActionManager.updateRunner(newRunner);

            // Update storedState to reflect actual counts
            storedState.playerCount = currentSlotCount;
            storedState.playerNames = newPlayerNames;
          }

          // Apply player names and colors from lobby selections
          // Players may have changed names or selected different colors than the auto-assigned ones
          if (storedState.lobbySlots) {
            for (const slot of storedState.lobbySlots) {
              const player = session.#runner.game.getPlayer(slot.seat);
              if (player) {
                // Sync player name from lobby slot
                if (slot.name && player.name !== slot.name) {
                  player.name = slot.name;
                }
                // Sync player color from lobby slot
                const selectedColor = slot.playerOptions?.color as string | undefined;
                if (selectedColor) {
                  player.color = selectedColor;
                }
              }
            }
          }

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
            const aiPlayers = aiSlots.map(s => s.seat);
            const aiLevel = aiSlots[0].aiLevel || 'medium';
            storedState.aiConfig = {
              players: aiPlayers,
              level: aiLevel as 'easy' | 'medium' | 'hard',
            };
            session.#aiController = new AIController(
              GameClass,
              storedState.gameType,
              storedState.playerCount,
              storedState.aiConfig,
              botAIConfig
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
  // Animation Methods
  // ============================================

  /**
   * Acknowledge animation events for a player up to a given ID.
   *
   * This is NOT a game action - it doesn't modify game state or action history.
   * It's session-level bookkeeping for UI playback tracking.
   *
   * The playerSeat parameter is included for future multi-client support
   * (tracking per-client acknowledgment), but currently all clients share
   * the same game buffer.
   *
   * @param playerSeat - Player seat acknowledging events (1-indexed)
   * @param upToId - Acknowledge all events with ID <= this value
   */
  acknowledgeAnimations(playerSeat: number, upToId: number): void {
    // Delegate to game's acknowledge method
    this.#runner.game.acknowledgeAnimationEvents(upToId);

    // Broadcast updated state to all clients
    // This ensures all clients see the events have been consumed
    this.broadcast();
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
        errorCode = ErrorCode.INVALID_PICK;
      }
      return { success: false, error: result.error, errorCode };
    }

    // Update stored action history
    this.#storedState.actionHistory = this.#runner.actionHistory;

    // Create checkpoint if at interval (dev mode only)
    const actionIndex = this.#storedState.actionHistory.length;
    if (this.#checkpointManager?.shouldCheckpoint(actionIndex)) {
      this.#checkpointManager.capture(this.#runner.game, actionIndex);
    }

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
      const playerObj = this.#runner.game.getPlayer(player);
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
   *
   * In development mode, uses dev state transfer (fast, bypasses replay):
   * - Captures current game state directly
   * - Creates new game with new class definitions
   * - Transfers state to new game (stored properties transfer, getters recompute)
   *
   * Falls back to replay if dev transfer fails or in production.
   */
  reloadWithCurrentRules(definition: GameDefinition): void {
    // Validate game type matches
    if (definition.gameType !== this.#storedState.gameType) {
      throw new Error(`Cannot reload: game type mismatch (expected ${this.#storedState.gameType}, got ${definition.gameType})`);
    }

    const isDev = process.env.NODE_ENV !== 'production';

    // In dev mode, try dev state transfer first
    if (isDev) {
      try {
        const newRunner = this.#reloadWithDevTransfer(definition);
        if (newRunner) {
          this.#runner = newRunner;
          this.#GameClass = definition.gameClass as GameClass<G>;
          this.#pickHandler = this.#pickHandler.updateRunner(newRunner);
          this.#pendingActionManager.updateRunner(newRunner);
          this.broadcast();
          return;
        }
      } catch (error) {
        // Log warning and fall back to replay
        console.warn(
          `[HMR] ⚠️ Dev state transfer failed, falling back to replay:\n` +
          `  Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Fallback: Replay all actions with the new game class
    const newRunner = this.#reloadWithReplay(definition);

    // Replace the current runner and game class
    this.#runner = newRunner;
    this.#GameClass = definition.gameClass as GameClass<G>;

    // Update handlers with new runner reference
    this.#pickHandler = this.#pickHandler.updateRunner(newRunner);
    this.#pendingActionManager.updateRunner(newRunner);

    // Broadcast updated state to all clients
    this.broadcast();
  }

  /**
   * Reload using dev state transfer (fast path for HMR).
   * Returns the new runner if successful, null if transfer not possible.
   *
   * Pre-validates snapshot before attempting restore:
   * - Missing classes → detailed error with registration instructions
   * - Schema errors → corrupted snapshot warning
   * - Property mismatches → path and suggestions
   *
   * Returns null on validation failure, triggering replay fallback.
   */
  #reloadWithDevTransfer(definition: GameDefinition): GameRunner<G> | null {
    // Capture current state
    const snapshot = captureDevState(this.#runner.game);
    const elementCount = getSnapshotElementCount(snapshot);

    // Capture flow state before HMR (will be restored after transfer)
    const oldFlowState = this.#runner.getFlowState();
    const oldFlowDefinition = this.#runner.game.getFlow();

    console.log(`[HMR] Capturing state: ${elementCount} elements`);

    // Build class registry from the NEW game class
    // We create a temporary game instance to get the class registry populated by registerElements()
    // This ensures we have the NEW classes (with correct identity) for validation and restoration
    const tempGame = new (definition.gameClass as GameClass<G>)({
      playerCount: this.#storedState.playerCount,
      playerNames: this.#storedState.playerNames,
      seed: this.#storedState.seed,
      ...this.#storedState.gameOptions,
    });
    const classRegistry = tempGame._ctx.classRegistry;

    // Also add the Game class itself to the registry (registerElements only adds element classes)
    classRegistry.set(definition.gameClass.name, definition.gameClass as any);

    // Pre-transfer validation
    const validation = validateDevSnapshot(snapshot, classRegistry);

    if (!validation.valid) {
      // Log detailed errors
      const errorSummary = this.#formatValidationSummary(validation);
      console.warn(errorSummary);

      // Try checkpoint recovery before falling back to full replay
      if (this.#checkpointManager) {
        const checkpoint = this.#checkpointManager.findNearest(this.#storedState.actionHistory.length);
        if (checkpoint) {
          console.log(`[HMR] Found checkpoint at action ${checkpoint.actionIndex}, attempting partial replay...`);
          const newRunner = this.#reloadFromCheckpoint(checkpoint, definition);
          if (newRunner) return newRunner;
        }
      }

      console.log('[HMR] Falling back to full replay...');
      return null;
    }

    // Log warnings if any (but continue with transfer)
    if (validation.warnings.length > 0) {
      console.warn(`[HMR] Validation warnings (${validation.warnings.length}):`);
      for (const warning of validation.warnings) {
        console.warn(`  ⚠️ ${warning.message}`);
        if (warning.path.length > 0) {
          console.warn(`     Path: ${warning.path.join(' > ')}`);
        }
      }
    }

    // Restore game with new classes
    const newGame = restoreDevState(
      snapshot,
      definition.gameClass as GameClass<G>,
      {
        gameOptions: {
          playerCount: this.#storedState.playerCount,
          playerNames: this.#storedState.playerNames,
          seed: this.#storedState.seed,
          ...this.#storedState.gameOptions,
        },
        classRegistry,
      }
    );

    // Create new runner with restored game
    const newRunner = new GameRunner<G>({
      GameClass: definition.gameClass as GameClass<G>,
      gameType: this.#storedState.gameType,
      gameOptions: {
        playerCount: this.#storedState.playerCount,
        playerNames: this.#storedState.playerNames,
        seed: this.#storedState.seed,
        ...this.#storedState.gameOptions,
      },
    });

    // Replace the runner's game with our restored game
    // @ts-expect-error - Accessing readonly property for HMR
    newRunner.game = newGame;

    // Copy action history to the new runner
    newRunner.actionHistory.push(...this.#storedState.actionHistory);

    // Restore flow state if there was an active flow
    // The flow definition comes from the new game class (via its static flow property or setup)
    // but we restore the full state (position + awaitingInput + currentPlayer, etc.)
    if (oldFlowState && oldFlowDefinition) {
      try {
        // The new game class may have a different flow definition (that's the point of HMR)
        // Get the flow from the new game class if it's set, otherwise use the old one
        const newFlowDef = newGame.getFlow() ?? oldFlowDefinition;
        if (!newGame.getFlow()) {
          newGame.setFlow(newFlowDef);
        }
        // Restore the full flow state (not just position) to preserve awaitingInput, etc.
        newGame.restoreFlowState(oldFlowState);
        console.log(`[HMR] ✓ Flow state restored`);
      } catch (error) {
        // Flow structure may have changed, fall back to replay
        console.warn(`[HMR] ⚠️ Flow restore failed: ${error instanceof Error ? error.message : error}`);
        console.log('[HMR] Falling back to full replay...');
        return null;
      }
    }

    console.log(
      `[HMR] ✓ State transferred (${elementCount} elements)\n` +
      `[HMR] ✓ Getters will use new logic\n` +
      `[HMR] Reload complete`
    );

    return newRunner;
  }

  /**
   * Format validation result for console output.
   * Groups errors by type and provides actionable summary.
   */
  #formatValidationSummary(validation: DevValidationResult): string {
    const lines: string[] = [];

    // Count by type
    const classMissing = validation.errors.filter(e => e.type === 'missing-class').length;
    const schemaErrors = validation.errors.filter(e => e.type === 'schema-error').length;
    const propMismatch = validation.errors.filter(e => e.type === 'property-mismatch').length;

    const parts: string[] = [];
    if (classMissing > 0) parts.push(`${classMissing} missing class${classMissing > 1 ? 'es' : ''}`);
    if (schemaErrors > 0) parts.push(`${schemaErrors} schema error${schemaErrors > 1 ? 's' : ''}`);
    if (propMismatch > 0) parts.push(`${propMismatch} property mismatch${propMismatch > 1 ? 'es' : ''}`);

    lines.push(`[HMR] Validation failed (${validation.errors.length} error${validation.errors.length > 1 ? 's' : ''}: ${parts.join(', ')}):`);
    lines.push('');

    for (let i = 0; i < validation.errors.length; i++) {
      const error = validation.errors[i];
      lines.push(`  ${i + 1}. ${error.message}`);
      if (error.path.length > 0) {
        lines.push(`     Path: ${error.path.join(' > ')}`);
      }
      lines.push(`     Fix: ${error.suggestion}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Reload using action replay (fallback path).
   * Slower but more reliable for complex state changes.
   */
  #reloadWithReplay(definition: GameDefinition): GameRunner<G> {
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
          `[HMR] ⚠️ STATE MISMATCH after replay!\n` +
          `  Before: seq=${oldSequence}, elements=${oldElementCount}\n` +
          `  After:  seq=${newSequence}, elements=${newElementCount}\n` +
          `  This may cause game corruption. Check if your game has randomness outside seed control.`
        );
      } else {
        console.log(
          `[HMR] ✓ Replay complete: seq=${newSequence}, elements=${newElementCount}`
        );
      }
    }

    return newRunner;
  }

  /**
   * Reload from a checkpoint when dev state transfer fails.
   * Restores the checkpoint state and replays only the actions after the checkpoint.
   * Returns null if checkpoint restore fails, triggering full replay fallback.
   */
  #reloadFromCheckpoint(checkpoint: DevCheckpoint, definition: GameDefinition): GameRunner<G> | null {
    try {
      // Build class registry from the NEW game class
      // Create a temporary game instance to get the NEW class registry
      const tempGame = new (definition.gameClass as GameClass<G>)({
        playerCount: this.#storedState.playerCount,
        playerNames: this.#storedState.playerNames,
        seed: this.#storedState.seed,
        ...this.#storedState.gameOptions,
      });
      const classRegistry = tempGame._ctx.classRegistry;

      // Also add the Game class itself to the registry (registerElements only adds element classes)
      classRegistry.set(definition.gameClass.name, definition.gameClass as any);

      // Validate checkpoint snapshot with new classes
      const validation = validateDevSnapshot(checkpoint, classRegistry);
      if (!validation.valid) {
        console.warn('[HMR] Checkpoint validation failed, falling back to full replay');
        return null;
      }

      // Restore from checkpoint
      const restoredGame = restoreDevState(
        checkpoint,
        definition.gameClass as GameClass<G>,
        {
          gameOptions: {
            playerCount: this.#storedState.playerCount,
            playerNames: this.#storedState.playerNames,
            seed: this.#storedState.seed,
            ...this.#storedState.gameOptions,
          },
          classRegistry,
        }
      );

      // Create runner with restored game
      const newRunner = new GameRunner<G>({
        GameClass: definition.gameClass as GameClass<G>,
        gameType: this.#storedState.gameType,
        gameOptions: {
          playerCount: this.#storedState.playerCount,
          playerNames: this.#storedState.playerNames,
          seed: this.#storedState.seed,
          ...this.#storedState.gameOptions,
        },
      });

      // @ts-expect-error - Accessing readonly for HMR
      newRunner.game = restoredGame;

      // Copy action history up to checkpoint
      newRunner.actionHistory.push(...this.#storedState.actionHistory.slice(0, checkpoint.actionIndex));

      // Replay remaining actions
      const remainingActions = this.#storedState.actionHistory.slice(checkpoint.actionIndex);
      for (const action of remainingActions) {
        const result = newRunner.performAction(action.name, action.player, action.args);
        if (!result.success) {
          console.warn(`[HMR] Action replay failed at ${action.name}, falling back to full replay`);
          return null;
        }
      }

      console.log(
        `[HMR] ✓ Restored from checkpoint (action ${checkpoint.actionIndex})\n` +
        `[HMR] ✓ Replayed ${remainingActions.length} actions\n` +
        `[HMR] Reload complete`
      );

      return newRunner;
    } catch (error) {
      console.warn('[HMR] Checkpoint restore failed:', error);
      return null;
    }
  }

  // ============================================
  // Undo Methods
  // ============================================

  /**
   * Undo actions back to the start of the current player's turn.
   * Only works if it's the player's turn and they've made at least one action.
   */
  async undoToTurnStart(playerPosition: number): Promise<UndoResult> {
    const result = await this.#stateHistory.undoToTurnStart(playerPosition);
    // Clear checkpoints after undo
    if (result.success && result.actionsUndone && result.actionsUndone > 0) {
      this.#checkpointManager?.clearAfter(this.#storedState.actionHistory.length);
    }
    return result;
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
    const result = await this.#stateHistory.rewindToAction(targetActionIndex);
    // Clear checkpoints after rewind
    if (result.success) {
      this.#checkpointManager?.clearAfter(targetActionIndex);
    }
    return result;
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
  // Pick Choices Methods (delegated to PickHandler)
  // ============================================

  /**
   * Get choices for any pick.
   * This is the unified endpoint for fetching pick choices on-demand.
   * Called when advancing to a new pick in the action flow.
   * A "pick" represents a choice the player must make.
   *
   * @param actionName Name of the action
   * @param selectionName Name of the pick to get choices for
   * @param playerPosition Player requesting choices
   * @param currentArgs Arguments collected so far (for dependent picks)
   * @returns Choices/elements with display strings and board refs, plus multiSelect config
   */
  getPickChoices(
    actionName: string,
    selectionName: string,
    playerPosition: number,
    currentArgs: Record<string, unknown> = {}
  ): PickChoicesResponse {
    return this.#pickHandler.getPickChoices(actionName, selectionName, playerPosition, currentArgs);
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
      const effectivePosition = session.isSpectator ? 0 : session.playerSeat;
      const state = buildPlayerState(this.#runner, this.#storedState.playerNames, effectivePosition, { includeActionMetadata: true, includeDebugData: true });

      const update: StateUpdate = {
        type: 'state',
        flowState,
        state,
        playerSeat: session.playerSeat,
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
   * Check if AI should play and execute move.
   * Uses a circuit breaker to stop retrying after repeated failures,
   * preventing infinite loops when the AI can't clone the game state.
   */
  async #checkAITurn(): Promise<void> {
    if (!this.#aiController) return;

    let move: { action: string; player: number; args: Record<string, unknown> } | null = null;

    try {
      move = await this.#aiController.checkAndPlay(
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
    } catch (error) {
      // AI threw (e.g., failed to clone game for MCTS search)
      const flowState = this.#runner.getFlowState();
      if (flowState?.awaitingInput && !flowState.complete) {
        this.#aiConsecutiveFailures++;
        if (this.#aiConsecutiveFailures >= 3) {
          console.error(
            `[AI] Giving up after ${this.#aiConsecutiveFailures} consecutive failures. ` +
            `The game may have non-deterministic flow logic (e.g., an execute block that ` +
            `completes the game during replay). Last error: ${error instanceof Error ? error.message : error}`
          );
          return;
        }
        this.#scheduleAICheck();
      }
      return;
    }

    // If AI made a move, reset failure counter and check again
    if (move) {
      this.#aiConsecutiveFailures = 0;
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
   * Claim a seat in the lobby
   *
   * @param seat Seat to claim (1-indexed)
   * @param playerId Player's unique ID
   * @param name Player's display name
   * @returns Result with updated lobby info
   */
  async claimSeat(
    seat: number,
    playerId: string,
    name: string
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    return this.#lobbyManager.claimSeat(seat, playerId, name);
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
   * @param seat Seat of the slot to remove
   * @returns Result with updated lobby info
   */
  async removeSlot(
    playerId: string,
    seat: number
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    return this.#lobbyManager.removeSlot(playerId, seat);
  }

  /**
   * Toggle a slot between open and AI (host only)
   *
   * @param playerId Must be the creator's ID
   * @param seat Seat of the slot to modify
   * @param isAI Whether to make this an AI slot
   * @param aiLevel AI difficulty level (if isAI is true)
   * @returns Result with updated lobby info
   */
  async setSlotAI(
    playerId: string,
    seat: number,
    isAI: boolean,
    aiLevel: string = 'medium'
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    const result = await this.#lobbyManager.setSlotAI(playerId, seat, isAI, aiLevel);
    // If game started, also broadcast initial game state
    if (result.success && result.gameStarted) {
      this.broadcast();
    }
    return result;
  }

  /**
   * Compute default player options for a seat (static version)
   * Takes into account options already taken by other players
   */
  static computeDefaultPlayerOptions(
    seat: number,
    definitions: Record<string, PlayerOptionDefinition>,
    lobbySlots: LobbySlot[],
    playerCount: number
  ): Record<string, unknown> {
    return LobbyManager.computeDefaultPlayerOptions(seat, definitions, lobbySlots, playerCount);
  }

  /**
   * Get seat for a player ID
   */
  getSeatForPlayer(playerId: string): number | undefined {
    return this.#lobbyManager?.getSeatForPlayer(playerId);
  }

  /**
   * Broadcast lobby state to all connected sessions
   */
  broadcastLobby(): void {
    this.#lobbyManager?.broadcastLobby();
  }

  /**
   * Leave/unclaim a seat in the lobby
   * Used when a player leaves the waiting room
   */
  async leaveSeat(playerId: string): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    return this.#lobbyManager.leaveSeat(playerId);
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
   * @param seat Seat of the player to kick
   * @returns Result with updated lobby info
   */
  async kickPlayer(
    hostPlayerId: string,
    seat: number
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    return this.#lobbyManager.kickPlayer(hostPlayerId, seat);
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
   * @param seat The slot seat to update
   * @param options The player options to set
   * @returns Result with updated lobby info
   */
  async updateSlotPlayerOptions(
    hostPlayerId: string,
    seat: number,
    options: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    return this.#lobbyManager.updateSlotPlayerOptions(hostPlayerId, seat, options);
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
