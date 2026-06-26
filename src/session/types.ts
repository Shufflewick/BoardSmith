/**
 * Shared types for game hosting.
 *
 * Protocol-level types (lobby, game options, WebSocket messages) are owned by
 * '../types/protocol.js' (boardsmith/types) and re-exported here for the
 * session surface — they are defined once, in one place.
 */

import type { FlowState, SerializedAction, Game, AnimationEvent, GameStateSnapshot } from '../engine/index.js';
import type { AIConfig as BotAIConfig } from '../ai/index.js';
import type { TutorialDefinition, TutorialStepView, Annotation } from '../engine/tutorial/types.js';
import type {
  LobbyState,
  SlotStatus,
  LobbySlot,
  LobbyInfo,
  NumberOption,
  SelectOption,
  BooleanOption,
  GameOptionDefinition,
  WebSocketMessage,
} from '../types/protocol.js';

// ============================================
// Error Codes
// ============================================

/**
 * Standard error codes for programmatic error handling.
 *
 * Re-exported from the protocol layer (`boardsmith/types`), which is the single
 * source of truth so that lower layers (runtime) can emit codes at the point an
 * error originates and higher layers pass them through unchanged.
 */
// Import locally (so ErrorCode is usable as a type in this module) AND re-export
// it, keeping the protocol layer as the single source of truth.
import { ErrorCode } from '../types/protocol.js';
export { ErrorCode };

// Re-export debug tracing types from engine for convenience
export type { ActionTrace, PickTrace, ConditionDetail } from '../engine/index.js';

// Re-export repeating selection types from engine
export type { PendingActionState, RepeatingSelectionState, RepeatConfig } from '../engine/index.js';

import type { RefWithRole } from '../engine/action/types.js';
export type { RefWithRole };

// Re-export tutorial types for consumers of the session surface
export type {
  TutorialDefinition,
  TutorialStep,
  TutorialGate,
  TutorialGateAllowList,
  TutorialGateCondition,
  TutorialAdvanceCondition,
  TutorialGateContext,
  TutorialProgress,
  TutorialStepView,
} from '../engine/tutorial/types.js';

// ============================================
// Game Class Types
// ============================================

/**
 * Game class constructor type
 */
export type GameClass<G extends Game = Game> = new (options: {
  playerCount: number;
  playerNames?: string[];
  seed?: string;
}) => G;

/**
 * Game definition for registering games
 */
export interface GameDefinition {
  gameClass: GameClass;
  gameType: string;
  minPlayers: number;
  maxPlayers: number;
  displayName?: string;
  /** AI configuration (objectives and threat response hooks) */
  ai?: BotAIConfig;
  /** Game-level configurable options */
  gameOptions?: Record<string, GameOptionDefinition>;
  /** Per-player configurable options */
  playerOptions?: Record<string, PlayerOptionDefinition>;
  /** Preset configurations for quick setup */
  presets?: GamePreset[];
  /**
   * Optional tutorial definition for this game.
   *
   * Threaded un-serialized (like `ai`) from here into the engine via
   * `GameSession.create()` → `GameOptions.tutorial` → `Game.tutorialDefinition`.
   * The definition is static config (step ids, gates, reserved content) and
   * must NOT be serialized — mirrors the `_actions` / `ai` pattern.
   */
  tutorial?: TutorialDefinition;
}

// ============================================
// Game Option Metadata Types
// ============================================

// Game option definitions are owned by ../types/protocol.js (single source of
// truth) and re-exported here for the session surface.
export type { NumberOption, SelectOption, BooleanOption, GameOptionDefinition };

/**
 * Standard per-player option definition (shown for each player slot)
 */
export interface StandardPlayerOption {
  type: 'select' | 'color' | 'text';
  label: string;
  description?: string;
  default?: string;
  choices?: Array<{ value: string; label: string }> | string[];
}

/**
 * Exclusive player option - renders as radio button, exactly one player can have this
 *
 * Use for asymmetric games where exactly one player must have a specific role.
 *
 * @example
 * ```typescript
 * playerOptions: {
 *   isDictator: {
 *     type: 'exclusive',
 *     label: 'Dictator',
 *     description: 'Select which player is the dictator',
 *     default: 'last',  // 'first', 'last', or player index number
 *   },
 * }
 * ```
 */
export interface ExclusivePlayerOption {
  type: 'exclusive';
  label: string;
  description?: string;
  /**
   * Which player has this option by default.
   * - 'first': Player 1 (first player)
   * - 'last': Last player
   * - number: Specific player seat (1-indexed)
   */
  default?: 'first' | 'last' | number;
}

/**
 * Per-player option definition (shown for each player slot)
 */
export type PlayerOptionDefinition = StandardPlayerOption | ExclusivePlayerOption;

/**
 * Per-player configuration in requests
 */
export interface PlayerConfig {
  name?: string;
  isAI?: boolean;
  aiLevel?: string;
  /** Custom player options (color, role, etc.) */
  [key: string]: unknown;
}

/**
 * Preset configuration for quick game setup
 */
export interface GamePreset {
  name: string;
  description?: string;
  /** Game options to apply */
  options: Record<string, unknown>;
  /** Per-player configurations */
  players?: PlayerConfig[];
}

/**
 * Game configuration (player count limits)
 */
export interface GameConfig {
  minPlayers: number;
  maxPlayers: number;
}

// ============================================
// Game State Types
// ============================================

/**
 * Persisted game state - stored in database/storage
 */
export interface StoredGameState {
  gameType: string;
  playerCount: number;
  playerNames: string[];
  playerIds?: string[];
  seed?: string;
  actionHistory: SerializedAction[];
  /**
   * Authoritative game-state snapshot — the SINGLE source of truth that
   * {@link StoredGameState} reconstructs from on cold restore.
   *
   * Produced by `runner.getSnapshot()`, it carries the full element tree, flow
   * position, sequence counter, RNG state, original constructor options, and the
   * per-action undo checkpoints. `GameSession.restore()` rebuilds via
   * `GameRunner.fromSnapshot(snapshot)` — it does NOT replay `actionHistory`,
   * because selection-step and pending-completed mutations are recorded in
   * neither command nor action history and replaying them mis-positions the flow.
   *
   * `actionHistory` is still persisted alongside it, but ONLY for undo
   * turn-detection (`computeUndoInfo`) — never for state reconstruction.
   *
   * Optional only so the type can model stored state loaded from older
   * persistence that predates this field; `restore()` fails loud when it is
   * absent rather than silently falling back to unsound replay.
   */
  snapshot?: GameStateSnapshot;
  createdAt: number;
  aiConfig?: AIConfig;
  /** Game-specific options (for restart) */
  gameOptions?: Record<string, unknown>;
  /** Lobby state - 'waiting' until all players join, then 'playing' */
  lobbyState?: LobbyState;
  /** Per-slot information for lobby (who claimed what, AI status, etc.) */
  lobbySlots?: LobbySlot[];
  /** Creator's player ID */
  creatorId?: string;
  /** Min/max players for this game type (for lobby slot management) */
  minPlayers?: number;
  maxPlayers?: number;
  /** Player options definitions (for initializing defaults when claiming) */
  playerOptionsDefinitions?: Record<string, PlayerOptionDefinition>;
  /** Game options definitions (for host to modify in lobby) */
  gameOptionsDefinitions?: Record<string, GameOptionDefinition>;
  /** Whether players can select colors in the lobby */
  colorSelectionEnabled?: boolean;
  /** Available color palette (hex strings) */
  colors?: string[];
}

/**
 * Reference to a board element for highlighting
 */
export interface ElementRef {
  id?: number;
  name?: string;
  notation?: string;
}

/**
 * Choice with optional board references for highlighting
 */
export interface ChoiceWithRefs {
  value: unknown;
  display: string;
  /** Board element references with roles (source/target/highlight) */
  refs?: RefWithRole[];
  /** Disabled reason string, present only when choice is disabled */
  disabled?: string;
}

/**
 * Valid element for element selection
 */
export interface ValidElement {
  id: number;
  /** Display label for this element */
  display?: string;
  /** Board element references with roles (typically [{ ref, role: 'highlight' }]) */
  refs?: RefWithRole[];
  /** Disabled reason string, present only when element is disabled */
  disabled?: string;
}

/**
 * Filter configuration for dependent picks.
 * A "pick" represents a choice the player must make during action resolution.
 */
export interface PickFilter {
  /** Key in the choice value object to filter by */
  key: string;
  /** Name of the previous pick to match against */
  selectionName: string;
}

/**
 * Pick metadata for auto-UI generation.
 * A "pick" represents a choice the player must make during action resolution.
 */
export interface PickMetadata {
  name: string;
  type: 'choice' | 'element' | 'elements' | 'number' | 'text';
  prompt?: string;
  /** If true, shows "Skip" button. If a string, shows that text instead. */
  optional?: boolean | string;
  // Type-specific properties
  choices?: ChoiceWithRefs[];
  min?: number;
  max?: number;
  integer?: boolean;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  elementClassName?: string;
  /** For element picks: list of valid element IDs the user can select */
  validElements?: ValidElement[];
  /** For choice picks: filter choices based on a previous pick */
  filterBy?: PickFilter;
  /**
   * For choice picks with dependsOn: name of the pick this depends on.
   * When present, use choicesByDependentValue to look up choices based on
   * the current value of the dependent pick.
   */
  dependsOn?: string;
  /**
   * For choice picks with dependsOn: choices indexed by the dependent pick's value.
   * Key is the string representation of the dependent value (element ID, player seat, etc.)
   */
  choicesByDependentValue?: Record<string, ChoiceWithRefs[]>;
  /**
   * For element picks with dependsOn: elements indexed by the dependent pick's value.
   * Key is the string representation of the dependent value (element ID, player seat, etc.)
   * Used when chooseElement()/chooseElements() has the dependsOn option.
   */
  elementsByDependentValue?: Record<string, ValidElement[]>;
  /** For repeating choice picks: configuration for repeat behavior */
  repeat?: {
    /** Whether the pick has an onEach callback (requires server round-trip) */
    hasOnEach: boolean;
    /** The terminator value (if using repeatUntil shorthand) */
    terminator?: unknown;
  };
  /**
   * For choice picks with dependsOn + multiSelect: multiSelect config indexed by dependent value.
   * Key is the string representation of the dependent value (element ID, player seat, etc.)
   * Value is the multiSelect config for that dependent value, or undefined if single-select.
   */
  multiSelectByDependentValue?: Record<string, { min: number; max?: number } | undefined>;
  /** Whether this selection has an onSelect callback (requires server round-trip per step) */
  hasOnSelect?: boolean;
  /** For multi-select choice picks: min/max selection configuration */
  multiSelect?: {
    /** Minimum selections required (default: 1) */
    min: number;
    /** Maximum selections allowed (undefined = unlimited) */
    max?: number;
  };
}

/**
 * Action metadata for auto-UI generation
 */
export interface ActionMetadata {
  name: string;
  prompt?: string;
  selections: PickMetadata[];
}

/**
 * Response from getPickChoices endpoint.
 * Used when fetching choices on-demand for any pick type.
 * A "pick" represents a choice the player must make during action resolution.
 */
export interface PickChoicesResponse {
  success: boolean;
  error?: string;
  /** Programmatic error code for switch statements. See ErrorCode enum. */
  errorCode?: ErrorCode;
  /** For choice picks: formatted choices with display strings and board refs */
  choices?: ChoiceWithRefs[];
  /** For element/elements picks: valid elements the user can select */
  validElements?: ValidElement[];
  /** Multi-select configuration (evaluated at request time for function-based configs) */
  multiSelect?: { min: number; max?: number };
}

/**
 * A single per-cell entry in the evaluation heatmap.
 *
 * Session-layer only, never serialized. Built from {@link BotMoveStats} by
 * `GameSession.#buildHeatmapEntries()` — one entry per distinct destination
 * cell, keeping the highest normalizedValue when multiple moves share a cell.
 */
export interface HeatmapEntry {
  /** Board element reference for this candidate move's destination cell. */
  cellRef: ElementRef;
  /** Normalized win-rate in [0, 1] from MCTS stats (value / visits). */
  normalizedValue: number;
  /** True for the single entry with the maximum normalizedValue in the set. */
  isBest: boolean;
}

/**
 * Player-facing game state - what clients receive
 */
export interface PlayerGameState {
  phase: string;
  /** Full player data including custom properties (abilities, score, etc.) */
  players: Array<{ name: string; seat: number; [key: string]: unknown }>;
  currentPlayer?: number;
  availableActions?: string[];
  isMyTurn: boolean;
  view: unknown;
  /** Action metadata for auto-UI generation (optional) */
  actionMetadata?: Record<string, ActionMetadata>;
  /** Whether the player can undo (has made actions this turn) */
  canUndo?: boolean;
  /** Number of actions made by this player since turn start */
  actionsThisTurn?: number;
  /** Action index where this player's current turn started */
  turnStartActionIndex?: number;
  /** Custom debug data from game's registerDebug() calls (optional, debug mode only) */
  customDebug?: Record<string, unknown>;
  /** Animation events pending playback (from game buffer). Only present when events exist. */
  animationEvents?: AnimationEvent[];
  /** ID of the last animation event, for acknowledgment convenience. Only present when events exist. */
  lastAnimationEventId?: number;
  /** Whether color selection is enabled for this game (from game settings) */
  colorSelectionEnabled?: boolean;
  /** Formatted game messages visible to this player */
  messages?: Array<{ text: string }>;
  /**
   * RESERVED (Plan 104-04): Active tutorial step projected for this player.
   *
   * `undefined` when no tutorial is running for this seat. Populated by
   * `buildPlayerState` when `game.tutorialProgress.get(seat)?.status === 'running'`.
   *
   * Typed as the exported `TutorialStepView` so that the producer (104-04)
   * and all consumers (104-03 `suppressAutoFill`, Phase 105 annotation
   * overlay) bind to one named contract.
   */
  tutorial?: TutorialStepView;
  /**
   * RESERVED (Plan 104-02): Action-level gate reasons for this seat.
   *
   * Maps action name → human-readable reason string for actions that are
   * blocked by the active tutorial step's gate. `undefined` when no tutorial
   * is running or no actions are gated.
   *
   * This fills the gap identified in RESEARCH Pitfall 3: action availability
   * is currently a binary `string[]`; this field surfaces the "why" for gated
   * actions so the UI can render a tooltip / disabled state with a reason.
   */
  disabledActions?: Record<string, string>;
  /**
   * Session-layer only, never serialized. Transient move hint annotation for
   * this seat. Present only after `GameSession.requestHint(seat)` is called
   * and before the next action on that seat or an undo/rewind clears it.
   *
   * Injected post-`buildPlayerState()` in `GameSession.broadcast()`.
   */
  hint?: { annotation: Annotation };
  /**
   * Session-layer only, never serialized. Evaluation heatmap for this seat.
   * Present (and updated) while the player has the heatmap overlay toggled on
   * via `GameSession.setHeatmapVisible(seat, true)`.
   *
   * Injected post-`buildPlayerState()` in `GameSession.broadcast()`.
   */
  heatmap?: { visible: boolean; entries: HeatmapEntry[] };
  /**
   * Session-layer only, never serialized. Narration text for the current AI
   * demo move. Present between the `onBeforeMove` hook firing and the move
   * broadcasting; `undefined` otherwise.
   *
   * Injected post-`buildPlayerState()` in `GameSession.broadcast()`.
   */
  narration?: { text: string };
  /**
   * Session-layer only, never serialized. True while an AI-vs-AI demo is
   * running (startDemo() has been called and stopDemo() has not). Present in
   * broadcast state so all connected clients (including reconnecting windows
   * and second-window scenarios) derive this flag from session truth rather
   * than a local Vue ref that can desync (WR-04).
   *
   * Injected post-`buildPlayerState()` in `GameSession.broadcast()`.
   * Absent (undefined) when no demo is running.
   */
  isDemoRunning?: boolean;
}

// ============================================
// Lobby Types
// ============================================

// Re-export lobby types from canonical source
export type { LobbyState, SlotStatus, LobbySlot, LobbyInfo };

// ============================================
// Session Types
// ============================================

/**
 * Session identity for broadcasting
 */
export interface SessionInfo {
  playerId?: string;
  playerSeat: number;
  isSpectator: boolean;
}

/**
 * State update message sent to clients
 */
export interface StateUpdate {
  type: 'state';
  flowState: FlowState | undefined;
  state: PlayerGameState;
  playerSeat: number;
  isSpectator: boolean;
}

// ============================================
// AI Types
// ============================================

/**
 * AI player configuration
 */
export interface AIConfig {
  players: number[];
  level: string;
}

// ============================================
// Adapter Interfaces
// ============================================

/**
 * Storage adapter interface for persisting game state
 */
export interface StorageAdapter {
  save(state: StoredGameState): Promise<void>;
  load(): Promise<StoredGameState | null>;
}

/**
 * Broadcast adapter interface for real-time updates
 */
export interface BroadcastAdapter<TSession = SessionInfo> {
  getSessions(): TSession[];
  send(session: TSession, message: unknown): void;
}

// ============================================
// Request/Response Types
// ============================================

/**
 * Request to create a new game
 */
export interface CreateGameRequest {
  gameType: string;
  playerCount: number;
  playerNames?: string[];
  playerIds?: string[];
  seed?: string;
  aiPlayers?: number[];
  aiLevel?: string;
  /** Game-specific options (boardSize, targetScore, etc.) */
  gameOptions?: Record<string, unknown>;
  /** Per-player configurations (for lobby UI) */
  playerConfigs?: PlayerConfig[];
}

/**
 * Request to perform an action
 */
export interface ActionRequest {
  action: string;
  player: number;
  args: Record<string, unknown>;
}

// WebSocketMessage (a discriminated union) is owned by ../types/protocol.js
// (single source of truth) and re-exported here for the session surface.
export type { WebSocketMessage };

// ============================================
// Lobby Request/Response Types
// ============================================

/**
 * Request to claim a seat in the lobby
 */
export interface ClaimSeatRequest {
  /** Seat to claim (1-indexed) */
  seat: number;
  /** Player's name */
  name: string;
  /** Player's unique ID */
  playerId: string;
}

/**
 * Response to claim seat request
 */
export interface ClaimSeatResponse {
  success: boolean;
  error?: string;
  /** Updated lobby info */
  lobby?: LobbyInfo;
}

/**
 * Request to join the lobby (server assigns seat)
 */
export interface JoinLobbyRequest {
  /** Player's unique ID */
  playerId: string;
  /** Player's display name */
  name: string;
}

/**
 * Response to join lobby request
 */
export interface JoinLobbyResponse {
  success: boolean;
  error?: string;
  /** Updated lobby info */
  lobby?: LobbyInfo;
  /** Seat that was assigned by the server */
  seat?: number;
}

/**
 * Request to update player name
 */
export interface UpdateNameRequest {
  /** Player's unique ID */
  playerId: string;
  /** New name */
  name: string;
}

/**
 * Lobby state update message sent to clients
 */
export interface LobbyUpdate {
  type: 'lobby';
  lobby: LobbyInfo;
}

