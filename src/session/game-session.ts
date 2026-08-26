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
 * - bot scheduling
 */

import type { FlowState, SerializedAction, Game, PendingActionState, GameCommand, DevSnapshot, DevValidationResult, DevCheckpoint, FollowUpAction, GameOptions, GameStateSnapshot, PlayerStateView, FlowDebugInfo, Player } from '../engine/index.js';
import { canSeatAct } from '../engine/index.js';
import type { TutorialDefinition } from '../engine/tutorial/types.js';
import type { Annotation } from '../engine/tutorial/types.js';
import type { HeatmapEntry, SerializedFlowDebugInfo } from './types.js';
import { captureDevState, restoreDevState, validateDevSnapshot, formatValidationErrors, getSnapshotElementCount } from '../engine/index.js';
import { GameRunner, type CheckpointPolicy, type UndoPolicy } from '../runtime/index.js';
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
  type BotSeatConfig,
  type LobbyState,
  type LobbySlot,
  type LobbyInfo,
  type LobbyUpdate,
  type PlayerConfig,
  type PlayerOptionDefinition,
  type GameOptionDefinition,
  type PickChoicesResponse,
} from './types.js';
import { buildPlayerState, buildSingleActionMetadata, serializeFlowDebugInfo, serializePendingActionState } from './utils.js';
import { BotController } from './bot-controller.js';
import type { BotStrategy, BotMove, BotMoveStats } from '../bot/index.js';
import { createBot, parseBotLevel } from '../bot/index.js';
import type { ElementRef } from './types.js';
import { LobbyManager, type LobbyManagerCallbacks } from './lobby-manager.js';
import { PickHandler } from './pick-handler.js';
import { PendingActionManager } from './pending-action-manager.js';
import { StateHistory, type UndoResult, type ElementDiff } from './state-history.js';
import { DebugController } from './debug-controller.js';
import { DevCheckpointManager } from './dev-checkpoint-manager.js';
import { describeMoveDestination, describeMoveForHint } from './move-summary.js';
import { TutorialController } from './tutorial-controller.js';
import { autoAdvanceTutorial } from '../engine/tutorial/progress.js';

/**
 * Consecutive persistence-save failures before `persistenceHealthy` flips
 * false (ERR-03). Mirrors `#botConsecutiveFailures >= 3`'s give-up threshold
 * so both circuit breakers escalate at the same count.
 */
const PERSISTENCE_UNHEALTHY_THRESHOLD = 3;

/**
 * A single captured persistence failure. Never carries a stack trace or
 * file paths — sanitized message only (T-126-05).
 */
export interface PersistenceErrorEntry {
  message: string;
  timestamp: number;
}

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
  botSeats?: BotSeatConfig;
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
  /** bot configuration (objectives and threat response hooks) from game definition */
  botStrategy?: BotStrategy;
  /** Minimum number of players allowed (for lobby slot management) */
  minPlayers?: number;
  /** Maximum number of players allowed (for lobby slot management) */
  maxPlayers?: number;
  /**
   * Tutorial definition threaded from `GameDefinition.tutorial`.
   *
   * Passed un-serialized into `GameOptions.tutorial` so the engine stores it
   * as `Game.tutorialDefinition` (in `unserializableAttributes`). Mirrors how
   * `botStrategy` reaches `BotController` without touching the serialized state.
   */
  tutorial?: TutorialDefinition;
  /**
   * When `true`, disables all teaching/assist features for this session (LOCK-01).
   *
   * The four assist ops — requestHint, setHeatmapVisible, startDemo, startTutorial —
   * are rejected fail-loud with "Teaching features are disabled for this session."
   * Action help (help-toggle) and exitTutorial are never gated (D-06).
   *
   * This is a host anti-cheat control, not a game rule. Keeping it separate from
   * `gameOptions` prevents collision with a game that names its own option
   * `teachingDisabled` (D-01).
   */
  teachingDisabled?: boolean;
  /**
   * When `true`, `registerDebug()` payloads (`customDebug`) are attached to
   * broadcast/player-state payloads for this session (SEC-04/F15).
   *
   * Defaults to `false` — debug dumps of hidden game state must never be
   * broadcast to players/spectators unless a trusted `GameSession` consumer
   * (e.g. a local dev harness) explicitly opts in. This is a `GameSession`
   * constructor-time-only option, not a `boardsmith dev`/CLI-wired setting.
   */
  debugEnabled?: boolean;
  /**
   * Injectable hook invoked whenever a storage save fails (ERR-03). Never
   * rethrown by the caller — a throwing hook is swallowed and echoed via
   * `console.error` so it can never crash gameplay (T-126-06).
   *
   * @param error Sanitized `{message, timestamp}` — never a stack trace (T-126-05).
   * @param consecutiveFailures Running count of consecutive save failures.
   * @param healthy Current `persistenceHealthy` value (false once
   *   `consecutiveFailures >= PERSISTENCE_UNHEALTHY_THRESHOLD`), so consumers
   *   can escalate severity (e.g. warning -> error) without recomputing it.
   */
  onPersistenceError?: (error: PersistenceErrorEntry, consecutiveFailures: number, healthy: boolean) => void;
  /**
   * Per-action undo checkpoint retention, threaded from
   * `GameDefinition.checkpoints`. Absent: retain one checkpoint per action for
   * the life of the game, which makes the saved state grow by a full copy of
   * the element tree per action.
   *
   * Every runner this session builds -- create, restore, and both HMR reload
   * paths -- must be given the same policy: one that forgets it silently
   * reverts the game to unbounded retention from that point on.
   */
  checkpoints?: CheckpointPolicy;
  /**
   * The game's declared undo policy, threaded from `GameDefinition.undo`.
   * Absent: undo is unfenced against random draws (the default).
   *
   * Carried onto every runner this session builds -- create, restore, and both
   * HMR reload paths -- for the same reason as `checkpoints`: one that forgets
   * it silently unfences undo for the rest of the game.
   */
  undo?: UndoPolicy;
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
 * - bot player integration (optional)
 *
 * @example
 * ```typescript
 * // Create a new game
 * const session = GameSession.create({
 *   gameType: 'checkers',
 *   GameClass: CheckersGame,
 *   playerCount: 2,
 *   playerNames: ['Alice', 'Bob'],
 *   botSeats: { players: [1], level: 'medium' },
 * });
 *
 * // Set up broadcasting
 * session.setBroadcaster(myBroadcastAdapter);
 *
 * // Perform actions
 * const result = await session.performAction('move', 0, { from: 'a3', to: 'b4' });
 * ```
 */
/**
 * Build a hex→label map from a game's `color` player-option choices so the engine
 * can set `player.colorLabel` (e.g. "Red") for player-facing text. Returns
 * undefined when the game defines no labeled color choices — the engine then
 * falls back to the default palette names.
 */
function buildColorLabelMap(
  defs?: Record<string, PlayerOptionDefinition>,
): Record<string, string> | undefined {
  const colorDef = defs?.color;
  if (!colorDef || !('choices' in colorDef) || !colorDef.choices?.length) return undefined;
  const map: Record<string, string> = {};
  for (const choice of colorDef.choices) {
    if (typeof choice === 'object' && choice.value != null && choice.label) {
      map[String(choice.value)] = choice.label;
    }
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

/**
 * Read-only view of a {@link GameRunner}, exposed via {@link GameSession.runner}.
 *
 * Deliberately omits `performAction` (and every other mutating member) so that
 * `session.runner.performAction(...)` — a lookalike wrong path beside
 * `session.performAction(...)` that silently skips persistence/broadcast/
 * checkpoints/tutorials/bot scheduling (SESS-01/F29) — is unreachable both at
 * the type level (no such member in this interface) and at runtime (the
 * object built by {@link buildRunnerFacade} genuinely has no `performAction`
 * key, so untyped/JS callers get a `TypeError: ... is not a function` instead
 * of silently bypassing session bookkeeping).
 */
export interface ReadOnlyRunnerFacade<G extends Game = Game> {
  readonly game: G;
  readonly actionHistory: readonly SerializedAction[];
  getSnapshot(): GameStateSnapshot;
  getPlayerView(playerPosition: number): PlayerStateView;
  getAllPlayerViews(): PlayerStateView[];
  getFlowState(): FlowState | undefined;
  getFlowDebugInfo(): FlowDebugInfo;
  getPendingAction(playerPosition: number): PendingActionState | undefined;
  isComplete(): boolean;
  getWinners(): Player[];
}

/**
 * Build a {@link ReadOnlyRunnerFacade} that delegates every read to the live
 * `runner`. This is a genuinely narrower object literal — NOT a type-cast of
 * `runner` — so `.performAction` is `undefined` at runtime, not merely hidden
 * by TypeScript's type system.
 */
function buildRunnerFacade<G extends Game>(runner: GameRunner<G>): ReadOnlyRunnerFacade<G> {
  return {
    get game() {
      return runner.game;
    },
    get actionHistory() {
      return runner.actionHistory;
    },
    getSnapshot: () => runner.getSnapshot(),
    getPlayerView: (playerPosition: number) => runner.getPlayerView(playerPosition),
    getAllPlayerViews: () => runner.getAllPlayerViews(),
    getFlowState: () => runner.getFlowState(),
    getFlowDebugInfo: () => runner.getFlowDebugInfo(),
    getPendingAction: (playerPosition: number) => runner.getPendingAction(playerPosition),
    isComplete: () => runner.isComplete(),
    getWinners: () => runner.getWinners(),
  };
}

export class GameSession<G extends Game = Game, TSession extends SessionInfo = SessionInfo> {
  #runner: GameRunner<G>;
  #runnerFacade: ReadOnlyRunnerFacade<G>;
  readonly #storedState: StoredGameState;
  #GameClass: GameClass<G>;
  readonly #storage?: StorageAdapter;
  #botController?: BotController<G>;  // Mutable for dynamic bot slot changes
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
  /** Tutorial lifecycle controller — peer to PendingActionManager */
  #tutorialController: TutorialController<G>;
  /**
   * Tutorial definition kept on the session so `replaceRunner` can re-supply
   * it after undo/rewind (fromCheckpoint creates a runner without tutorial,
   * because tutorial is excluded from snapshot.gameOptions — see Game constructor).
   */
  readonly #tutorialDefinition?: TutorialDefinition;
  /** Dev checkpoint manager for fast HMR recovery (dev only) */
  #checkpointManager?: DevCheckpointManager<G>;
  /** Circuit breaker: consecutive bot failures before giving up */
  #botConsecutiveFailures = 0;
  /** Injectable persistence-failure hook (ERR-03). Never rethrown — see #persistSafely. */
  #onPersistenceError?: (error: PersistenceErrorEntry, consecutiveFailures: number, healthy: boolean) => void;
  /** Most recent sanitized persistence failure, or null if none has occurred yet. */
  #lastPersistenceError: PersistenceErrorEntry | null = null;
  /** Circuit breaker: consecutive persistence-save failures before persistenceHealthy flips false. */
  #persistenceConsecutiveFailures = 0;
  /**
   * Bot strategy config (objectives, hintTargetFromMove) kept on the session so
   * ephemeral bots for requestHint() and setHeatmapVisible() can use the
   * same game-specific extraction hook as the main BotController.
   */
  #botStrategy?: BotStrategy;

  // ============================================
  // Transient teaching state (Phase 107)
  // These fields are NEVER serialized. They are injected into broadcast state
  // post-buildPlayerState() and cleared on undo/rewind (replaceRunner).
  // ============================================

  /**
   * Per-seat thinking guard. Prevents two simultaneous hint searches for the
   * SAME seat (pointless work), but deliberately allows two different seats to
   * run hint searches concurrently in simultaneous-action games where both seats
   * can be awaiting input at the same time.
   *
   * Note: heatmap uses a session-wide boolean (#heatmapUpdating) because it
   * evaluates the full board across all candidate moves — a significantly more
   * expensive search that should not run concurrently for any pair of seats.
   * Hint searches are targeted at a single seat's decision and are cheaper.
   * (WR-07: deliberate scope difference, not an accidental inconsistency.)
   */
  #hintThinking = new Set<number>();
  /** Per-seat move hint annotation. Set by requestHint(), cleared after action or undo. */
  #hint = new Map<number, { annotation: Annotation }>();
  /** Per-seat evaluation heatmap. Set by setHeatmapVisible(), cleared on undo. */
  #heatmap = new Map<number, { visible: boolean; entries: HeatmapEntry[] }>();
  /** Narration text for the current bot demo move (between onBeforeMove and broadcast). */
  #narrationText: string | null = null;
  /** True while a demo (all-seats bot with narration) is running. */
  #demoMode = false;
  /** Saved BotController replaced by startDemo(); restored by stopDemo(). */
  #savedBotController?: BotController<G>;
  /** Delay (ms) between narration announcement and move execution in demo mode. */
  #demoDelay = 1200;
  /** Narration hook closure used as onBeforeMove in demo mode. Cleared by stopDemo(). */
  #onBeforeMove?: (action: string, player: number, args: Record<string, unknown>) => Promise<void>;
  /**
   * When true, the four teach/assist ops are rejected fail-loud (LOCK-01, D-01).
   * Set once at construction from `GameSessionOptions.teachingDisabled`; never toggled.
   */
  #teachingDisabled = false;
  /**
   * When true, `registerDebug()` payloads (`customDebug`) are attached to
   * broadcast/player-state payloads (SEC-04, D-SEC-04). Set once at
   * construction from `GameSessionOptions.debugEnabled`; never toggled.
   * Mirrors `#teachingDisabled`'s constructor-time-only shape. Defaults to
   * `false` — a `GameSession`-consumer-only opt-in, not persisted and not
   * wired to any CLI/dev-host setting.
   */
  #debugEnabled = false;

  private constructor(
    runner: GameRunner<G>,
    storedState: StoredGameState,
    GameClass: GameClass<G>,
    storage?: StorageAdapter,
    botController?: BotController<G>,
    displayName?: string,
    lobbyManager?: LobbyManager<TSession>,
    pickHandler?: PickHandler<G>,
    pendingActionManager?: PendingActionManager<G>,
    botStrategy?: BotStrategy,
    teachingDisabled?: boolean,
    onPersistenceError?: (error: PersistenceErrorEntry, consecutiveFailures: number, healthy: boolean) => void,
    debugEnabled?: boolean
  ) {
    this.#runner = runner;
    this.#runnerFacade = buildRunnerFacade(this.#runner);
    this.#storedState = storedState;
    this.#GameClass = GameClass;
    this.#storage = storage;
    this.#botController = botController;
    this.#debugEnabled = debugEnabled ?? false;
    this.#displayName = displayName;
    this.#lobbyManager = lobbyManager;
    this.#botStrategy = botStrategy;
    this.#teachingDisabled = teachingDisabled ?? false;
    this.#onPersistenceError = onPersistenceError;
    // Capture the tutorial definition from the initial runner so replaceRunner
    // can re-supply it (tutorial is excluded from snapshot.gameOptions and is
    // therefore absent on runners created by fromCheckpoint / fromSnapshot).
    this.#tutorialDefinition = runner.game.tutorialDefinition;

    // Initialize handlers - create them if not provided
    // The factory methods will create and pass these in
    this.#pickHandler = pickHandler ?? new PickHandler(runner, storedState.playerCount);
    this.#pendingActionManager = pendingActionManager ?? new PendingActionManager(
      runner,
      storedState,
      storage,
      {
        save: () => this.#save(),
        broadcast: () => this.broadcast(),
        scheduleBotCheck: () => this.#scheduleBotCheck(),
      },
      this.#debugEnabled
    );

    // Initialize state history and debug controller
    this.#stateHistory = new StateHistory(
      GameClass,
      storedState,
      () => this.#runner,
      {
        replaceRunner: (newRunner) => {
          this.#runner = newRunner;
          this.#runnerFacade = buildRunnerFacade(this.#runner);
          // Re-supply tutorial definition: fromCheckpoint creates a runner
          // without it (tutorial is excluded from snapshot.gameOptions so it
          // is not persisted — it must be re-threaded by the session layer).
          if (this.#tutorialDefinition) {
            newRunner.game.tutorialDefinition = this.#tutorialDefinition;
          }
          // Clear transient teaching state: element IDs from the old runner
          // are stale after undo/rewind (AnnotationTarget refs point at
          // elements that may no longer exist at the same IDs in the
          // restored snapshot). Callers must re-request a hint if needed.
          this.#hint.clear();
          this.#heatmap.clear();
          // Update handlers with new runner reference
          this.#pickHandler = this.#pickHandler.updateRunner(newRunner);
          this.#pendingActionManager.updateRunner(newRunner);
        },
        save: () => this.#save(),
        broadcast: () => this.broadcast(),
      },
      this.#debugEnabled
    );
    this.#debugController = new DebugController(
      () => this.#runner,
      {
        broadcast: () => this.broadcast(),
      }
    );
    this.#tutorialController = new TutorialController(
      () => this.#runner,
      {
        broadcast: () => this.broadcast(),
      }
    );

    // Initialize checkpoint manager in dev mode only
    if (process.env.NODE_ENV !== 'production') {
      this.#checkpointManager = new DevCheckpointManager<G>();
    }
  }

  // ============================================
  // Factory Methods
  // ============================================

  /**
   * Build the lobby-to-game handoff callbacks shared by `create` and `restore`.
   *
   * Both factory paths need identical behavior when the lobby transitions to
   * playing (recreate the runner from the current slots, sync player names/colors,
   * schedule bot) and when the bot config changes. Keeping a single implementation
   * here is the source of truth so a fix to one path can never silently miss the other.
   *
   * `getSession` defers the GameSession reference because the session is constructed
   * after the LobbyManager that holds these callbacks.
   */
  static #buildLobbyCallbacks<G extends Game>(params: {
    GameClass: GameClass<G>;
    storedState: StoredGameState;
    botStrategy: BotStrategy | undefined;
    getSession: () => GameSession<G>;
  }): LobbyManagerCallbacks {
    const { GameClass, storedState, botStrategy, getSession } = params;
    return {
      onGameStart: () => {
        const session = getSession();

        // Build playerConfigs from lobby slots for game constructor access
        // This allows games to access player options via options.playerConfigs[seat-1]
        const playerConfigs = storedState.lobbySlots?.map(slot => ({
          name: slot.name,
          isBot: slot.status === 'bot',
          botLevel: slot.botLevel,
          ...slot.playerOptions,
        }));

        // Check if player count changed in lobby (host added/removed players)
        const currentSlotCount = storedState.lobbySlots?.length ?? 0;

        // Color name map (hex → "Red"), derived from the persisted player-option
        // definitions so the recreated runner sets player.colorLabel for the log.
        const colorLabels = buildColorLabelMap(storedState.playerOptionsDefinitions);

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
            ...(colorLabels ? { colorLabels } : {}),
            playerConfigs,
          };

          const newRunner = new GameRunner<G>({
            GameClass,
            gameType: storedState.gameType,
            gameOptions: newGameOptions,
            // Carry the retention policy off the runner being replaced -- a
            // replacement runner that drops it silently reverts this game to
            // unbounded checkpoint retention.
            checkpoints: session.#runner.checkpointPolicy,
            undo: session.#runner.undoPolicy,
          });
          newRunner.start();

          // Replace the session's runner
          session.#runner = newRunner;
          session.#runnerFacade = buildRunnerFacade(session.#runner);
          session.#pickHandler = new PickHandler(newRunner, currentSlotCount);
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
              // Sync player color from lobby slot (and keep colorLabel in lockstep
              // so the name matches the player's chosen color, not the auto-assigned one).
              const selectedColor = slot.playerOptions?.color as string | undefined;
              if (selectedColor) {
                player.color = selectedColor;
                if (colorLabels?.[selectedColor]) player.colorLabel = colorLabels[selectedColor];
              }
            }
          }
        }

        // Refresh the authoritative snapshot now that the playing runner exists.
        // onGameStart recreates the runner (with playerConfigs) when the lobby
        // transitions waiting -> playing, so the snapshot captured at create()
        // (the waiting runner) is stale. Restore reconstructs from this snapshot,
        // so it must reflect the real, started game even before the first action
        // is taken (and before any storage.save). Updated in place so the next
        // #save / restore reads the correct started state.
        storedState.snapshot = session.#runner.getSnapshot();

        // Trigger bot check when game starts
        if (session.#botController?.hasBotPlayers()) {
          session.#scheduleBotCheck();
        }
      },
      onBotStrategyChanged: (botSlots: LobbySlot[]) => {
        const session = getSession();
        if (botSlots.length === 0) {
          storedState.botSeats = undefined;
          session.#botController = undefined;
        } else {
          const botPlayers = botSlots.map(s => s.seat);
          const botLevel = botSlots[0].botLevel || 'medium';
          storedState.botSeats = {
            players: botPlayers,
            level: botLevel as 'easy' | 'medium' | 'hard',
          };
          session.#botController = new BotController(
            GameClass,
            storedState.gameType,
            storedState.playerCount,
            storedState.botSeats,
            botStrategy
          );
        }
      },
    };
  }

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
      botSeats,
      gameOptions: customGameOptions,
      displayName,
      playerConfigs,
      creatorId,
      useLobby,
      playerOptionsDefinitions,
      gameOptionsDefinitions,
      botStrategy,
      minPlayers,
      maxPlayers,
      tutorial,
      teachingDisabled,
      debugEnabled,
      onPersistenceError,
      checkpoints,
      undo,
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
    // Color name map (hex → "Red") so players' colorLabel is set for player-facing
    // text. Derived from the game's labeled palette; undefined falls back to the
    // engine's default palette names.
    const colorLabels = buildColorLabelMap(playerOptionsDefinitions);
    const effectiveGameOptions = {
      playerCount,
      playerNames,
      seed: gameSeed,
      ...customGameOptions,
      ...(extractedColors ? { colors: extractedColors } : {}),
      ...(colorLabels ? { colorLabels } : {}),
      // Thread tutorial definition un-serialized into the game constructor
      // (mirrors how botStrategy/botStrategy reach BotController). The engine stores
      // it as Game.tutorialDefinition (in unserializableAttributes) so gate
      // evaluation can reach the definition without a session-layer round-trip.
      ...(tutorial ? { tutorial } : {}),
    };

    const runner = new GameRunner<G>({
      GameClass,
      gameType,
      gameOptions: effectiveGameOptions,
      checkpoints,
      undo,
    });

    // Build lobby slots from player configs
    let lobbySlots: LobbySlot[] | undefined;
    let lobbyState: LobbyState | undefined;

    if (useLobby && playerConfigs) {
      lobbySlots = playerConfigs.map((config, i) => {
        const isBot = config.isBot ?? false;
        const seat = i + 1; // 1-indexed seats
        const isCreator = seat === 1; // Seat 1 is always the creator

        // Extract player options (everything except name, isBot, botLevel)
        const playerOptions: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(config)) {
          if (!['name', 'isBot', 'botLevel'].includes(key)) {
            playerOptions[key] = value;
          }
        }

        return {
          seat,
          status: isBot ? 'bot' : (isCreator ? 'claimed' : 'open'),
          name: config.name ?? (isBot ? 'Bot' : `Player ${seat}`),
          playerId: isCreator ? creatorId : undefined,
          botLevel: isBot ? (config.botLevel ?? 'medium') : undefined,
          playerOptions: Object.keys(playerOptions).length > 0 ? playerOptions : undefined,
          // bot is always ready, humans start not ready
          ready: isBot ? true : false,
        } as LobbySlot;
      });

      // Initialize default player options for all non-open slots (host + bot)
      // Merge with existing preset options so preset values (e.g., color from preset config) take precedence
      if (playerOptionsDefinitions) {
        for (const slot of lobbySlots) {
          if (slot.status === 'open') continue;
          const defaults = GameSession.computeDefaultPlayerOptions(
            slot.seat,
            playerOptionsDefinitions,
            lobbySlots,
            playerCount
          );
          slot.playerOptions = { ...defaults, ...slot.playerOptions };
        }
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
    // This ensures host and pre-configured bot slots have colors from the start
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

    // For non-lobby games (e.g., --bot mode), apply default colors directly to players.
    // Lobby games apply colors later via the onGameStart callback.
    if (!useLobby && colorSelectionEnabled && colors) {
      for (let i = 0; i < playerCount; i++) {
        const player = runner.game.getPlayer(i + 1);
        if (player && !player.color) {
          const hex = colors[i % colors.length];
          player.color = hex;
          // Keep the label in lockstep with the color (createPlayers already did
          // this for the common path; this only fires when color was unset).
          if (colorLabels?.[hex]) player.colorLabel = colorLabels[hex];
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
      // Authoritative snapshot of the freshly-started runner. Restore reconstructs
      // from this (never by replay); it is refreshed on every persist via #save and
      // when a lobby game transitions to playing (onGameStart recreates the runner).
      snapshot: runner.getSnapshot(),
      createdAt: Date.now(),
      botSeats,
      teachingDisabled,
      displayName,
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

    const botController = botSeats
      ? new BotController(GameClass, gameType, playerCount, botSeats, botStrategy)
      : undefined;

    // Create lobby manager if using lobby flow
    let lobbyManager: LobbyManager | undefined;
    if (useLobby && lobbySlots) {
      // Session is constructed after the LobbyManager, so the callbacks read it lazily.
      const callbacks = GameSession.#buildLobbyCallbacks<G>({
        GameClass,
        storedState,
        botStrategy,
        getSession: () => session,
      });
      lobbyManager = new LobbyManager(storedState, storage, callbacks, displayName);
    }

    // Explicit annotation breaks the type-inference cycle: the lobby callbacks
    // capture `getSession: () => session` above, so `session` must have a known
    // type independent of its own initializer.
    const session: GameSession<G> = new GameSession(runner, storedState, GameClass, storage, botController, displayName, lobbyManager, undefined, undefined, botStrategy, teachingDisabled, onPersistenceError, debugEnabled);

    // Persist initial state (fire-and-forget to keep create synchronous).
    // Routed through #persistSafely (same funnel as every other save site) so
    // a failure here is observable via onPersistenceError/lastPersistenceError
    // instead of a bare console.error with no caller-visible signal.
    if (storage) {
      void session.#persistSafely(() => storage.save(storedState));
    }

    // Only trigger bot if game is playing (not waiting for players)
    if (lobbyState !== 'waiting' && botController?.hasBotPlayers()) {
      session.#scheduleBotCheck();
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
    botStrategy?: BotStrategy,
    tutorial?: TutorialDefinition,
    onPersistenceError?: (error: PersistenceErrorEntry, consecutiveFailures: number, healthy: boolean) => void,
    /**
     * The game's `GameDefinition.checkpoints` policy. Re-supplied here for the
     * same reason `tutorial` is: it is code-declared config, deliberately not
     * persisted in the stored state, so a restore that omits it silently
     * reverts the game to unbounded checkpoint retention.
     */
    checkpoints?: CheckpointPolicy,
    /**
     * The game's `GameDefinition.undo` policy. Re-supplied for the same reason
     * as `checkpoints`: code-declared config, deliberately not persisted, and a
     * restore that omits it silently unfences undo for the rest of the game.
     */
    undo?: UndoPolicy,
  ): GameSession<G> {
    // Snapshot-authoritative restore (audit F42). Reconstruct game state directly
    // from the persisted snapshot via GameRunner.fromSnapshot — NOT by replaying
    // actionHistory. Replay is unsound: selection-step / pending-completed actions
    // are recorded in neither command nor action history, so replaying an
    // incomplete actionHistory mis-positions the flow and crashes real games
    // ("Player N is not awaiting action"). fromSnapshot restores the element tree,
    // flow position, sequence, RNG, and per-action undo checkpoints authoritatively.
    if (!storedState.snapshot) {
      throw new Error(
        `Cannot restore game "${storedState.gameType}": the stored state has no snapshot. ` +
        `Snapshot-authoritative restore reconstructs game state from runner.getSnapshot(); ` +
        `it does NOT replay action history, because selection-step and pending-completed ` +
        `mutations are recorded in neither command nor action history and replaying them ` +
        `mis-positions the flow. This stored state predates the snapshot field (or was not ` +
        `produced through GameSession's save funnel). Start a new game so a snapshot is ` +
        `captured, or re-save the existing state under the current library version.`
      );
    }

    const runner = GameRunner.fromSnapshot<G>(storedState.snapshot, GameClass, { checkpoints, undo });

    // Re-supply static config that is intentionally excluded from the snapshot
    // (see Game constructor — tutorial is stripped from _constructorOptions so
    // serialization never tries to JSON.stringify predicate-style gates).
    // Mirrors create()'s threading: effectiveGameOptions.tutorial → runner.game.tutorialDefinition.
    // Also mirrors replaceRunner's guard so #tutorialDefinition stays live after restore.
    if (tutorial) runner.game.tutorialDefinition = tutorial;

    const botController = storedState.botSeats
      ? new BotController(GameClass, storedState.gameType, storedState.playerCount, storedState.botSeats, botStrategy)
      : undefined;

    // Create lobby manager if stored state has lobby slots
    let lobbyManager: LobbyManager | undefined;
    if (storedState.lobbySlots) {
      // Session is constructed after the LobbyManager, so the callbacks read it lazily.
      const callbacks = GameSession.#buildLobbyCallbacks<G>({
        GameClass,
        storedState,
        botStrategy,
        getSession: () => session,
      });
      lobbyManager = new LobbyManager(storedState, storage, callbacks);
    }

    // Explicit annotation breaks the type-inference cycle with the lobby
    // callbacks' `getSession: () => session` capture above.
    const session: GameSession<G> = new GameSession(runner, storedState, GameClass, storage, botController, storedState.displayName, lobbyManager, undefined, undefined, botStrategy, storedState.teachingDisabled, onPersistenceError);
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
   * Get the current game runner as a read-only facade (for advanced use cases).
   *
   * This is NOT the raw `GameRunner` — it exposes only read members (game,
   * actionHistory, getSnapshot, getPlayerView, ...). `performAction` is not
   * present, at the type level or at runtime, so it cannot be used as a
   * lookalike wrong path for `session.performAction()` (SESS-01/F29). All
   * writes must go through `session.performAction()`, which additionally
   * handles persistence/broadcast/checkpoints/tutorials/bot scheduling.
   */
  get runner(): ReadOnlyRunnerFacade<G> {
    return this.#runnerFacade;
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
   * Get the session display name (RST-02: persisted, survives restore()).
   */
  get displayName(): string | undefined {
    return this.#displayName;
  }

  /**
   * Whether teaching/assist features are disabled for this session (LOCK-01).
   * RST-02: persisted, survives restore().
   */
  get teachingDisabled(): boolean {
    return this.#teachingDisabled;
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
   * @param options.includeDebugData Include debug data from game.registerDebug() (default:
   *   the session's `debugEnabled` option, itself defaulting to `false` — SEC-04/F15)
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
      { includeActionMetadata: options?.includeActionMetadata ?? true, includeDebugData: options?.includeDebugData ?? this.#debugEnabled }
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
      { includeActionMetadata: options?.includeActionMetadata ?? true, includeDebugData: options?.includeDebugData ?? this.#debugEnabled }
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
  // Teaching API (Phase 107)
  // ============================================

  /**
   * Extract the destination ElementRef from a bot move.
   *
   * Priority:
   *  1. `config.hintTargetFromMove` — game-specific override
   *  2. Common destination arg names: `to`, `destination`, `target`, `square`, `cell`, `position`
   *  3. `undefined` — hint shows a floating bubble with no highlight ring
   */
  #extractMoveTarget(move: BotMove): ElementRef | undefined {
    if (this.#botStrategy?.hintTargetFromMove) {
      return this.#botStrategy.hintTargetFromMove(move);
    }
    const DEST_ARGS = ['to', 'destination', 'target', 'square', 'cell', 'position'] as const;
    for (const key of DEST_ARGS) {
      const val = move.args[key];
      // Accept numeric IDs and string notation/names as element refs
      if (typeof val === 'number') return { id: val };
      if (typeof val === 'string') return { notation: val };
    }
    return undefined;
  }

  /**
   * Request a move hint for the given seat.
   *
   * Runs an ephemeral MCTS search, extracts the suggested move's destination
   * cell, stores a transient hint annotation in `#hint`, and broadcasts. The
   * hint is cleared automatically after the next action on that seat or after
   * an undo/rewind.
   *
   * Throws (fail-loud) if:
   * - The seat is not currently awaiting input.
   * - A hint request for this seat is already in flight.
   *
   * On MCTS failure, the error is re-thrown so the UI can surface a
   * "Hint unavailable" toast — no fallback/silent failure.
   */
  async requestHint(seat: number): Promise<void> {
    if (this.#teachingDisabled) {
      throw new Error('Teaching features are disabled for this session.');
    }
    const flowState = this.#runner.getFlowState();
    if (!flowState || !canSeatAct(flowState, seat)) {
      throw new Error(`Cannot hint: seat ${seat} is not awaiting input`);
    }
    if (this.#hintThinking.has(seat)) {
      throw new Error(`Hint already in progress for seat ${seat}`);
    }
    this.#hintThinking.add(seat);
    try {
      const difficulty = parseBotLevel(this.#storedState.botSeats?.level ?? 'medium');
      const bot = createBot(
        this.#runner.game,
        this.#GameClass,
        this.#storedState.gameType,
        seat,
        this.#storedState.actionHistory,
        difficulty,
        this.#botStrategy
      );
      // Use play() (not playWithStats()) so parallel mode is honoured for
      // 'hard' difficulty. playWithStats() forces single-mode search and the
      // returned stats are unused here — the hint only needs the best move (WR-05).
      const move = await bot.play();
      const ref = this.#extractMoveTarget(move);
      const target = ref ? { kind: 'element' as const, ref } : undefined;
      const annotation: Annotation = { text: describeMoveForHint(move.args), ...(target ? { target } : {}) };
      this.#hint.set(seat, { annotation });
      this.broadcast();
    } finally {
      this.#hintThinking.delete(seat);
    }
  }

  /**
   * Clear the move hint for the given seat and broadcast.
   */
  clearHint(seat: number): void {
    this.#hint.delete(seat);
    this.broadcast();
  }

  /**
   * Guard: at most one heatmap recompute in flight across all seats (T-107-03).
   * This is session-wide (not per-seat) because MCTS is CPU-bound and concurrent
   * full-board evaluations would compete for the same CPU resources.
   */
  #heatmapUpdating = false;

  /**
   * Build per-cell HeatmapEntry[] from MCTS stats.
   *
   * Deduplication: multiple BotMoves targeting the same cell are collapsed into
   * one entry keeping the highest normalizedValue. Exactly one entry has
   * `isBest === true` (the highest normalizedValue in the set).
   */
  #buildHeatmapEntries(stats: BotMoveStats[]): HeatmapEntry[] {
    const byCell = new Map<string, HeatmapEntry>();
    for (const stat of stats) {
      const ref = this.#extractMoveTarget(stat.move);
      if (!ref) continue;
      // Stable key: prefer id > notation > name
      const key = ref.id !== undefined ? `id:${ref.id}`
        : ref.notation !== undefined ? `notation:${ref.notation}`
        : `name:${ref.name}`;
      const existing = byCell.get(key);
      if (!existing || stat.value > existing.normalizedValue) {
        byCell.set(key, { cellRef: ref, normalizedValue: stat.value, isBest: false });
      }
    }
    const entries = [...byCell.values()];
    if (entries.length > 0) {
      const best = entries.reduce((a, b) => a.normalizedValue > b.normalizedValue ? a : b);
      best.isBest = true;
    }
    return entries;
  }

  /**
   * Show or hide the evaluation heatmap for a seat.
   *
   * When `visible = true`: runs an ephemeral MCTS search, builds per-cell
   * entries (deduped, best-marked), stores them, and broadcasts.
   *
   * When `visible = false`: clears entries and broadcasts.
   *
   * Concurrent recompute attempts are skipped (not queued) — the bot search
   * is expensive and concurrent searches serve no purpose.
   */
  async setHeatmapVisible(seat: number, visible: boolean): Promise<void> {
    if (this.#teachingDisabled) {
      throw new Error('Teaching features are disabled for this session.');
    }
    if (!visible) {
      this.#heatmap.set(seat, { visible: false, entries: [] });
      this.broadcast();
      return;
    }

    // Fail-loud if a recompute is already in progress or the bot is thinking.
    // Consistent with requestHint() which also throws on concurrent access.
    // The caller (platform bridge) catches this and surfaces a "Busy" toast.
    if (this.#heatmapUpdating || this.#botController?.isThinking()) {
      throw new Error('Heatmap evaluation is already in progress — please wait.');
    }
    this.#heatmapUpdating = true;
    try {
      const entries = await this.#computeHeatmapEntries(seat);
      this.#heatmap.set(seat, { visible: true, entries });
      this.broadcast();
    } finally {
      this.#heatmapUpdating = false;
    }
  }

  /**
   * Run an ephemeral MCTS search for `seat` and build per-cell heatmap entries.
   * Shared by setHeatmapVisible() (initial toggle) and #refreshVisibleHeatmaps()
   * (per-turn recompute) so both paths produce identical entries.
   */
  async #computeHeatmapEntries(seat: number): Promise<HeatmapEntry[]> {
    const difficulty = parseBotLevel(this.#storedState.botSeats?.level ?? 'medium');
    const bot = createBot(
      this.#runner.game,
      this.#GameClass,
      this.#storedState.gameType,
      seat,
      this.#storedState.actionHistory,
      difficulty,
      this.#botStrategy
    );
    const { stats } = await bot.playWithStats();
    return this.#buildHeatmapEntries(stats);
  }

  /**
   * Keep every visible heatmap current after a move: recompute for the seat
   * whose turn it now is, and clear now-stale entries for any other seat whose
   * heatmap is still toggled on. Called from performAction so "Show move quality"
   * tracks the live position instead of freezing where it was first enabled
   * (symmetric with the per-action hint clear). Skips work when no heatmap is
   * visible or a recompute/bot search is already in flight.
   */
  async #refreshVisibleHeatmaps(): Promise<void> {
    if (this.#heatmap.size === 0) return;
    const flowState = this.#runner.getFlowState();
    let needsBroadcast = false;
    for (const [seat, hm] of this.#heatmap) {
      if (!hm.visible) continue;
      if (canSeatAct(flowState, seat)) {
        // It's this seat's turn — recompute fresh entries (guard against an
        // overlapping search; the next action will refresh if we skip here).
        if (this.#heatmapUpdating || this.#botController?.isThinking()) continue;
        this.#heatmapUpdating = true;
        try {
          const entries = await this.#computeHeatmapEntries(seat);
          this.#heatmap.set(seat, { visible: true, entries });
          needsBroadcast = true;
        } finally {
          this.#heatmapUpdating = false;
        }
      } else if (hm.entries.length > 0) {
        // Not this seat's turn — drop stale chips, leave the overlay toggled on.
        this.#heatmap.set(seat, { visible: true, entries: [] });
        needsBroadcast = true;
      }
    }
    if (needsBroadcast) this.broadcast();
  }

  // ============================================
  // Demo Mode (Phase 107 Plan 03)
  // ============================================

  /**
   * Whether a demo (narrated bot-vs-bot) is currently running.
   */
  get isDemoRunning(): boolean {
    return this.#demoMode;
  }

  /**
   * Start a bot-vs-bot demo: all seats are bot-controlled; each move is announced
   * (narration text set and broadcast) before it executes, paced by `delay` ms.
   *
   * The demo reuses the existing all-seats bot mechanism — no new bot or training.
   * Call `stopDemo()` to restore the original bot controller.
   *
   * @param options.narrator - Optional custom text formatter (action, player, args) → string.
   *   Defaults to `"PlayerName: actionName key=value ..."`. Object/array arg values are
   *   formatted with JSON.stringify in the default narrator. Games with rich arg types
   *   (e.g., move objects, nested references) should supply a custom `narrator` function
   *   for human-readable output.
   * @param options.delay - Delay (ms) between announcement and move execution. Default: 1200.
   */
  startDemo(options?: {
    narrator?: (action: string, player: number, args: Record<string, unknown>) => string;
    delay?: number;
  }): void {
    if (this.#teachingDisabled) {
      throw new Error('Teaching features are disabled for this session.');
    }
    // Idempotency guard: a second call before stopDemo() would overwrite
    // #savedBotController with the demo controller, making stopDemo() unable to
    // restore the original. Return early to prevent that corruption.
    if (this.#demoMode) return;

    // Save the current controller (may be undefined for human-only games).
    this.#savedBotController = this.#botController;
    this.#demoDelay = options?.delay ?? 1200;

    // Build an all-seats bot controller using the existing bot level (or 'medium' default).
    const botLevel = this.#storedState.botSeats?.level ?? 'medium';
    const allPlayers = Array.from(
      { length: this.#storedState.playerCount },
      (_, i) => i + 1
    );
    this.#botController = new BotController(
      this.#GameClass,
      this.#storedState.gameType,
      this.#storedState.playerCount,
      { players: allPlayers, level: botLevel },
      this.#botStrategy
    );

    // Build the narration closure.
    const playerNames = this.#storedState.playerNames;
    const demoDelay = this.#demoDelay;
    const session = this;

    this.#onBeforeMove = async (action: string, player: number, args: Record<string, unknown>) => {
      // Compute narration text.
      let text: string;
      if (options?.narrator) {
        text = options.narrator(action, player, args);
      } else {
        // Default: "PlayerName: actionName c5 → a3 (capture)". Formats a readable
        // destination from destination-like args only (never raw element ids), so
        // the narration reads as prose instead of dumping JSON. Games with rich arg
        // types should still supply a custom `narrator` function.
        const name = playerNames[player - 1] ?? `Player ${player}`;
        const dest = describeMoveDestination(args);
        text = dest ? `${name}: ${action} ${dest}` : `${name}: ${action}`;
      }

      // Set narration and broadcast the announcement BEFORE the move executes.
      session.#narrationText = text;
      session.broadcast();

      // Pace the demo — the move executes after this resolves.
      await new Promise<void>(r => setTimeout(r, demoDelay));
    };

    this.#demoMode = true;
    // Broadcast immediately so all connected clients (including other windows)
    // see isDemoRunning=true before the first bot move fires (WR-04).
    this.broadcast();
    this.#scheduleBotCheck();
  }

  /**
   * Stop the bot-vs-bot demo. Restores the original bot controller, clears the
   * narration hook and narration text, and broadcasts the cleared state.
   */
  stopDemo(): void {
    this.#botController = this.#savedBotController;
    this.#savedBotController = undefined;
    this.#onBeforeMove = undefined;
    this.#narrationText = null;
    this.#demoMode = false;
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
      // Prefer the structured code the runner emitted at the point of failure.
      // Only fall back to inferring from the message for errors that originate
      // deeper in the engine's flow (which still surface as plain strings).
      let errorCode = result.errorCode;
      if (!errorCode) {
        if (result.error?.includes('not available')) {
          errorCode = ErrorCode.ACTION_NOT_AVAILABLE;
        } else if (result.error?.includes('not found')) {
          errorCode = ErrorCode.ACTION_NOT_FOUND;
        } else if (result.error?.includes('Invalid selection')) {
          errorCode = ErrorCode.INVALID_PICK;
        }
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

    // Persist if storage adapter is provided (refreshes the authoritative
    // snapshot first — see #save).
    await this.#save();

    // Clear hint for the acting player: any hint shown before this action is
    // now stale (the board state has changed). Cleared before broadcast so
    // the first post-action frame never shows a stale ring.
    this.#hint.delete(player);

    // Broadcast to all connected clients
    this.broadcast();

    // Post-action auto-advance: evaluate advanceWhen predicates server-side for every
    // seat with a running tutorial. An opponent's action can satisfy a learner's predicate,
    // so we iterate ALL running-tutorial seats (not just the acting player).
    // If any seat advanced, re-broadcast so clients render the new step.
    // This is a no-op (zero extra broadcast) when no tutorial is running (T-106-04).
    {
      const game = this.#runner.game;
      let anyAdvanced = false;
      for (const [seat, progress] of game.tutorialProgress) {
        if (progress.status !== 'running') continue;
        const { advanced } = autoAdvanceTutorial(game, seat);
        if (advanced) anyAdvanced = true;
      }
      if (anyAdvanced) {
        await this.#save();   // persist the advanced tutorial progress
        this.broadcast();
      }
    }

    // Refresh any visible "Show move quality" heatmaps for the new position
    // (recompute for whoever is on move, clear stale chips for the rest) before
    // the bot is scheduled, so the recompute runs while no bot search is active.
    await this.#refreshVisibleHeatmaps();

    // Check if bot should respond
    this.#scheduleBotCheck();

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
      state: buildPlayerState(this.#runner, this.#storedState.playerNames, player, { includeActionMetadata: true, includeDebugData: this.#debugEnabled }),
      serializedAction: result.serializedAction,
      // Pass through action chaining info from flowState, including metadata for the followUp action
      followUp: followUpWithMetadata,
      // The action's own return value to the acting seat (BUG-017/BUG-012).
      data: result.data,
      message: result.message,
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
          this.#runnerFacade = buildRunnerFacade(this.#runner);
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
    this.#runnerFacade = buildRunnerFacade(this.#runner);
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
    const gameOptions = this.#buildGameOptions();
    const tempGame = new (definition.gameClass as GameClass<G>)(gameOptions as any);
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
        gameOptions,
        classRegistry,
      }
    );

    // Create new runner with restored game
    const newRunner = new GameRunner<G>({
      GameClass: definition.gameClass as GameClass<G>,
      gameType: this.#storedState.gameType,
      gameOptions,
      checkpoints: definition.checkpoints,
      undo: definition.undo,
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
        gameOptions: this.#buildGameOptions(),
        checkpoints: definition.checkpoints,
        undo: definition.undo,
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
      const gameOptions = this.#buildGameOptions();

      // Build class registry from the NEW game class
      // Create a temporary game instance to get the NEW class registry
      const tempGame = new (definition.gameClass as GameClass<G>)(gameOptions as any);
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
          gameOptions,
          classRegistry,
        }
      );

      // Create runner with restored game
      const newRunner = new GameRunner<G>({
        GameClass: definition.gameClass as GameClass<G>,
        gameType: this.#storedState.gameType,
        gameOptions,
        checkpoints: definition.checkpoints,
        undo: definition.undo,
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

  /**
   * Build full game options from stored state, including playerConfigs
   * reconstructed from lobbySlots when available.
   *
   * All game reconstruction paths (HMR, restore, checkpoint) MUST use this
   * to ensure the constructor receives the same options as the original game.
   */
  #buildGameOptions(): GameOptions & Record<string, unknown> {
    const colorLabels = buildColorLabelMap(this.#storedState.playerOptionsDefinitions);
    const options: GameOptions & Record<string, unknown> = {
      playerCount: this.#storedState.playerCount,
      playerNames: this.#storedState.playerNames,
      seed: this.#storedState.seed,
      ...this.#storedState.gameOptions,
      ...(colorLabels ? { colorLabels } : {}),
    };

    // Reconstruct playerConfigs from lobbySlots so constructor-time logic
    // (e.g. setting up bot flags, roles) runs correctly in clones/replays
    if (this.#storedState.lobbySlots && this.#storedState.lobbyState === 'playing') {
      options.playerConfigs = this.#storedState.lobbySlots.map(slot => ({
        name: slot.name,
        isBot: slot.status === 'bot',
        botLevel: slot.botLevel,
        ...slot.playerOptions,
      }));
    }

    return options;
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
    followUp?: FollowUpAction & { metadata?: ReturnType<typeof buildSingleActionMetadata> };
    /** `ActionResult.data` from the action this step completed (BUG-017). */
    data?: Record<string, unknown>;
    /** `ActionResult.message` from the action this step completed (BUG-012). */
    message?: string;
  }> {
    const result = await this.#pendingActionManager.processSelectionStep(playerPosition, selectionName, value, actionName, initialArgs);

    // Build followUp with metadata if present (same pattern as executeAction)
    if (result.followUp) {
      const playerObj = this.#runner.game.getPlayer(playerPosition);
      const followUpMetadata = playerObj ? buildSingleActionMetadata(this.#runner.game, playerObj, result.followUp.action, result.followUp.args) : undefined;
      return {
        ...result,
        followUp: {
          ...result.followUp,
          metadata: followUpMetadata,
        },
      };
    }

    return result;
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
  // Tutorial Lifecycle Methods (delegated to TutorialController)
  // ============================================

  /**
   * Start the tutorial for the given seat.
   *
   * Sets progress to the first step with status `'running'` and broadcasts.
   * Throws if no tutorial definition is registered (`GameDefinition.tutorial`).
   *
   * @param seat - 1-indexed seat number of the learner.
   */
  startTutorial(seat: number): void {
    if (this.#teachingDisabled) {
      throw new Error('Teaching features are disabled for this session.');
    }
    this.#tutorialController.start(seat);
  }

  /**
   * Advance the tutorial to the next step for the given seat.
   *
   * If on the last step, marks the tutorial as `'completed'`. Broadcasts once.
   *
   * @param seat - 1-indexed seat number of the learner.
   */
  advanceTutorial(seat: number): void {
    this.#tutorialController.advance(seat);
  }

  /**
   * Skip the current step for the given seat (same forward move as advance).
   *
   * Broadcasts once.
   *
   * @param seat - 1-indexed seat number of the learner.
   */
  skipTutorial(seat: number): void {
    this.#tutorialController.skip(seat);
  }

  /**
   * Exit the tutorial for the given seat.
   *
   * Sets status to `'exited'`; gate enforcement is lifted. Broadcasts once.
   *
   * @param seat - 1-indexed seat number of the learner.
   */
  exitTutorial(seat: number): void {
    this.#tutorialController.exit(seat);
  }

  // ============================================
  // Persistence
  // ============================================

  /**
   * Most recent sanitized persistence failure (ERR-03), or `null` if no save
   * has ever failed. Never contains a stack trace or file paths (T-126-05).
   */
  get lastPersistenceError(): PersistenceErrorEntry | null {
    return this.#lastPersistenceError;
  }

  /**
   * `false` once `PERSISTENCE_UNHEALTHY_THRESHOLD` consecutive saves have
   * failed; recovers to `true` on the very next successful save. Mirrors the
   * `#botConsecutiveFailures >= 3` circuit-breaker shape so both subsystems
   * escalate at the same threshold.
   *
   * Best-effort under concurrent callers (WR-01): `#persistenceConsecutiveFailures`
   * is incremented/reset around an unguarded `await op()` with no serialization
   * queue, so if two `#persistSafely` calls are ever in flight concurrently for
   * the same session, a failing save's increment can be raced by an overlapping
   * successful save's reset (or vice versa). Every known call site (create()'s
   * initial save, #save()'s direct-action/tutorial/bot-turn paths) awaits
   * `#persistSafely` sequentially, so this is a documented limitation rather
   * than an observed bug — not exact under a hypothetical host that overlaps
   * saves for the same session.
   */
  get persistenceHealthy(): boolean {
    return this.#persistenceConsecutiveFailures < PERSISTENCE_UNHEALTHY_THRESHOLD;
  }

  /**
   * Runs a storage-save operation without ever letting it crash the caller
   * (ERR-03 / T-126-03). On success, resets the consecutive-failure counter
   * (restoring `persistenceHealthy`). On failure, increments the counter,
   * records a sanitized `lastPersistenceError` (never a stack trace —
   * T-126-05), echoes via `console.error`, and invokes `onPersistenceError`
   * — itself guarded so a throwing hook can never crash gameplay (T-126-06).
   *
   * This is the single funnel every GameSession save path (create()'s
   * initial save, #save()'s direct-action/tutorial/bot-turn paths) is routed
   * through, so a storage outage is always observable and never misclassified
   * as an unrelated failure (e.g. the bot circuit breaker — Pitfall 2 / T-126-04).
   */
  // NOTE (WR-01): no serialization guard around the counter increment/reset —
  // see the `persistenceHealthy` doc comment for the concurrency caveat.
  async #persistSafely(op: () => Promise<void>): Promise<void> {
    try {
      await op();
      this.#persistenceConsecutiveFailures = 0;
    } catch (error) {
      this.#persistenceConsecutiveFailures++;
      const entry: PersistenceErrorEntry = {
        message: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
      this.#lastPersistenceError = entry;
      console.error(
        `[Persistence] save failed (${this.#persistenceConsecutiveFailures} consecutive): ${entry.message}`
      );
      try {
        this.#onPersistenceError?.(entry, this.#persistenceConsecutiveFailures, this.persistenceHealthy);
      } catch (hookError) {
        console.error(
          `[Persistence] onPersistenceError hook threw: ${hookError instanceof Error ? hookError.message : String(hookError)}`
        );
      }
    }
  }

  /**
   * Persist the stored state, refreshing the authoritative snapshot first.
   *
   * The snapshot (`runner.getSnapshot()`) is the SINGLE source of truth that
   * `GameSession.restore()` reconstructs from via `GameRunner.fromSnapshot` — it
   * carries the element tree, flow position, sequence counter, RNG state, original
   * constructor options, and the per-action undo checkpoints. Producing it here,
   * at the exact moment of persistence, guarantees the saved snapshot can never
   * drift from the live runner state.
   *
   * This is the single funnel for every GameSession save path (direct actions, bot
   * moves, pending/selection steps, undo, rewind), so no caller can persist a
   * stale or snapshot-less stored state. No-ops without a storage adapter (there
   * is nothing to restore from when state is never persisted).
   *
   * Never throws (ERR-03) — routed through #persistSafely so a save failure on
   * ANY caller (including the bot-turn path inside #checkBotTurn's try/catch)
   * cannot propagate and be misclassified as an unrelated failure.
   */
  async #save(): Promise<void> {
    if (!this.#storage) return;
    this.#storedState.snapshot = this.#runner.getSnapshot();
    const storage = this.#storage;
    await this.#persistSafely(() => storage.save(this.#storedState));
  }

  // ============================================
  // Broadcasting
  // ============================================

  /**
   * Broadcast current state to all connected sessions
   */
  broadcast(): void {
    // Refresh the runner's per-action undo checkpoint on every state change.
    // broadcast() is the universal post-mutation funnel (human actions, bot moves,
    // pending selection steps, and cancels all broadcast), so this keeps
    // StateHistory.undoToTurnStart's authoritative checkpoints current even
    // though the stateful session persists only actionHistory. Runs before the
    // broadcaster guard so it also works headless (no clients connected).
    this.#runner.captureCheckpoint();

    if (!this.#broadcaster) return;

    const flowState = this.#runner.getFlowState();
    const sessions = this.#broadcaster.getSessions();

    // Flow position is public game structure (T-123-08), not per-seat hidden
    // info — safe to compute once and reuse across every seat/spectator in
    // the loop below. Shared serializer (utils.ts) also used by the stateless
    // dev-host path and the debug:flow-state op — one wire shape everywhere.
    const flowDebugInfo: SerializedFlowDebugInfo = serializeFlowDebugInfo(this.#runner.game);

    for (const session of sessions) {
      const effectivePosition = session.isSpectator ? 0 : session.playerSeat;
      const state = buildPlayerState(this.#runner, this.#storedState.playerNames, effectivePosition, { includeActionMetadata: true, includeDebugData: this.#debugEnabled });

      // Inject transient teaching state — never derived from engine, never serialized.
      // These fields are injected after buildPlayerState() to keep that function pure.
      state.flowDebugInfo = flowDebugInfo;
      // SECURITY (T-123-07): pendingAction MUST be looked up per-seat inside
      // this loop using this seat's own effectivePosition — never hoisted
      // outside the loop or shared across seats. A seat must never receive
      // another seat's accumulated pending-action args.
      const pendingAction = this.getPendingAction(effectivePosition);
      if (pendingAction) state.pendingAction = serializePendingActionState(pendingAction);
      const hint = this.#hint.get(effectivePosition);
      if (hint) state.hint = hint;
      const heatmap = this.#heatmap.get(effectivePosition);
      if (heatmap) state.heatmap = heatmap;
      if (this.#narrationText) state.narration = { text: this.#narrationText };
      // isDemoRunning broadcast so all windows derive their state from the
      // session rather than local Vue refs (WR-04).
      if (this.#demoMode) state.isDemoRunning = true;
      // teachingDisabled broadcast unconditionally (both true and false) so
      // reconnecting clients and second windows always read the authoritative
      // session value rather than relying on a local init message (D-03, LOCK-01).
      state.teachingDisabled = this.#teachingDisabled;

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
  // Bot Integration
  // ============================================

  /**
   * Schedule a bot check (non-blocking)
   */
  #scheduleBotCheck(): void {
    if (!this.#botController?.hasBotPlayers()) return;

    // Use setImmediate/setTimeout to avoid blocking
    const schedule = typeof setImmediate !== 'undefined'
      ? setImmediate
      : (fn: () => void) => setTimeout(fn, 0);

    schedule(() => this.#checkBotTurn());
  }

  /**
   * Check if bot should play and execute move.
   * Uses a circuit breaker to stop retrying after repeated failures,
   * preventing infinite loops when the bot can't clone the game state.
   */
  async #checkBotTurn(): Promise<void> {
    if (!this.#botController) return;

    let move: { action: string; player: number; args: Record<string, unknown> } | null = null;

    try {
      move = await this.#botController.checkAndPlay(
        this.#runner,
        this.#storedState.actionHistory,
        async (action, player, args) => {
          const result = this.#runner.performAction(action, player, args);
          if (result.success) {
            this.#storedState.actionHistory = this.#runner.actionHistory;
            // Auto-advance tutorial for all running seats after a bot action.
            // Mirrors the post-action pump in performAction — opponent moves must
            // trigger advanceWhen evaluation for every learner seat (CR-02).
            const game = this.#runner.game;
            let anyAdvanced = false;
            for (const [seat, progress] of game.tutorialProgress) {
              if (progress.status === 'running') {
                const { advanced } = autoAdvanceTutorial(game, seat);
                if (advanced) anyAdvanced = true;
              }
            }
            // Persistence failures here are routed through #persistSafely (via
            // #save) and NEVER thrown, so a storage outage during a bot turn
            // counts against #persistenceConsecutiveFailures — never against
            // #botConsecutiveFailures below (Pitfall 2 / T-126-04 regression fix).
            await this.#save();
            // Clear narration after the move executes so the announcement is
            // transient (shown during the delay, gone after the move lands).
            this.#narrationText = null;
            this.broadcast();
            if (anyAdvanced) this.broadcast();
            return true;
          }
          return false;
        },
        // Demo narration hook: undefined outside demo mode (no-op to standard bot turns).
        this.#onBeforeMove
      );
    } catch (error) {
      // bot threw (e.g., failed to clone game for MCTS search)
      const flowState = this.#runner.getFlowState();
      if (flowState?.awaitingInput && !flowState.complete) {
        this.#botConsecutiveFailures++;
        if (this.#botConsecutiveFailures >= 3) {
          console.error(
            `[bot] Giving up after ${this.#botConsecutiveFailures} consecutive failures. ` +
            `The game may have non-deterministic flow logic (e.g., an execute block that ` +
            `completes the game during replay). Last error: ${error instanceof Error ? error.message : error}`
          );
          return;
        }
        this.#scheduleBotCheck();
      }
      return;
    }

    // If bot made a move, reset failure counter and check again
    if (move) {
      this.#botConsecutiveFailures = 0;
      this.#scheduleBotCheck();
    } else {
      // Even if no move was made (e.g., turn changed during delay, or blocked by #thinking),
      // we should still check if another bot player needs to act
      const flowState = this.#runner.getFlowState();
      if (flowState?.awaitingInput && !flowState.complete) {
        this.#scheduleBotCheck();
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
  getLobbyInfo(viewerPlayerId?: string): LobbyInfo | null {
    return this.#lobbyManager?.getLobbyInfo(viewerPlayerId) ?? null;
  }

  /**
   * Resolve the seat for an authenticated player connection.
   *
   * Identity MUST be derived from a claimed lobby slot or the game's
   * registered playerIds — never from a self-asserted seat parameter. Returns
   * -1 (spectator) when the playerId is missing or cannot be matched, so an
   * unknown or absent id can never be granted another player's seat or
   * private view.
   */
  resolveSeatForPlayer(playerId: string | undefined): number {
    if (!playerId) return -1;
    const lobbySeat = this.getSeatForPlayer(playerId);
    if (lobbySeat !== undefined) return lobbySeat;
    const ids = this.#storedState.playerIds;
    if (ids) {
      const idx = ids.indexOf(playerId);
      if (idx >= 0) return idx + 1;  // Convert 0-indexed array position to 1-indexed seat
    }
    return -1;
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
   * Join the lobby — server assigns the first available open seat.
   *
   * @param playerId Player's unique ID
   * @param name Player's display name
   * @returns Result with assigned seat and updated lobby info
   */
  async joinLobby(
    playerId: string,
    name: string
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo; seat?: number }> {
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    return this.#lobbyManager.joinLobby(playerId, name);
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
   * Remove a player slot (host only, slot must be open or bot)
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
   * Toggle a slot between open and bot (host only)
   *
   * @param playerId Must be the creator's ID
   * @param seat Seat of the slot to modify
   * @param isBot Whether to make this a bot slot
   * @param botLevel bot difficulty level (if isBot is true)
   * @returns Result with updated lobby info
   */
  async setSlotBot(
    playerId: string,
    seat: number,
    isBot: boolean,
    botLevel: string = 'medium'
  ): Promise<{ success: boolean; error?: string; lobby?: LobbyInfo }> {
    if (!this.#lobbyManager) {
      return { success: false, error: 'Game does not have a lobby' };
    }
    const result = await this.#lobbyManager.setSlotBot(playerId, seat, isBot, botLevel);
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
