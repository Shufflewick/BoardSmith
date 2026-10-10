/**
 * Shared types for game hosting.
 *
 * Protocol-level types (lobby, game options, WebSocket messages) are owned by
 * '../types/protocol.js' (boardsmith/types) and re-exported here for the
 * session surface — they are defined once, in one place.
 */

import type { FlowState, Game, GameClass, AnimationEvent, PendingActionState } from '../engine/index.js';
import type { BotStrategy } from '../bot/index.js';
import type { TutorialDefinition, TutorialStepView, Annotation } from '../engine/tutorial/types.js';
import type { CheckpointPolicy, UndoPolicy } from '../engine/index.js';
import type { WorldDefinition } from '../world/definition.js';
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
  PlayerConfig,
  CreateGameRequest,
  ClaimSeatRequest,
  ClaimSeatResponse,
  JoinLobbyRequest,
  JoinLobbyResponse,
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

import type { RefWithRole, FollowUpOffer } from '../engine/action/types.js';
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
 * Game definition for registering games
 */
export interface GameDefinition {
  gameClass: GameClass;
  gameType: string;
  /**
   * THE TABLE'S SEAT RANGE, and the table backend's alone.
   *
   * Optional because a world has no table: it does not start, so there is no
   * minimum to reach, and its seats are `world.maxPlayers` -- a lifetime count,
   * not a roster a match is assembled from. A world game that declared these
   * shipped a vestigial table half beside its world, and a person opened one,
   * was asked for a second player by a game one person plays alone, and started
   * the table instead of the world (ShufflewickPub #354).
   *
   * A game whose backend is `table` must declare both; `capabilityContradictions`
   * refuses one that does not, and `boardsmith build` omits `playerCount` from
   * the manifest when they are absent.
   */
  minPlayers?: number;
  maxPlayers?: number;
  displayName?: string;
  /** bot configuration (objectives and threat response hooks) */
  bot?: BotStrategy;
  /**
   * Whether this game keeps CROSS-SESSION state -- a hall of fame, a campaign's
   * character sheets, a persistent world's board between rounds.
   *
   * The platform gates every persistence read and write on the same flag in a
   * published manifest, and a game that does not set it makes no extra call on
   * either path. `boardsmith dev` reads it here so a game's local runs behave
   * the way its published ones will: without it there is no store to hand the
   * `start` op and nothing is committed at game over.
   */
  persistence?: boolean;
  /**
   * THE PERSISTENT-WORLD HALF OF THIS DEFINITION.
   *
   * A world's commands, its genesis, its per-seat view and its presence hooks,
   * typed by `boardsmith/world` -- the module that also RUNS them. That is the
   * point of naming the shape here rather than leaving it an open record: one
   * declaration, imported by the runtime and by every world bundle, cannot
   * drift. The open record it replaces was the second half of a mistake whose
   * first half was every world game hand-copying the contract.
   *
   * The engine's own share of a world is still only `GameOptions.worldMode`
   * (docs/core-concepts.md, "Snapshot Mode and World Mode"), which unlocks the
   * partition APIs and changes nothing else. What reads this block is
   * `src/world/`, and a host -- `boardsmith dev` on a laptop or a hosting
   * platform's own runner -- is what drives that.
   *
   * TRANSITIONAL in its members: a world's verbs are a flat command table
   * today and become Actions, at which point `WorldDefinition` changes shape
   * and every world game is updated in one pass. See the note on
   * `WorldCommandHandler`.
   *
   * docs/persistent-worlds.md is the authoring guide.
   */
  world?: WorldDefinition;
  /** Game-level configurable options */
  gameOptions?: Record<string, GameOptionDefinition>;
  /** Per-player configurable options */
  playerOptions?: Record<string, PlayerOptionDefinition>;
  /** Preset configurations for quick setup */
  presets?: GamePreset[];
  /**
   * Code-declared color palette for this game's seats. The single
   * source-of-truth entry shape ({id,hex,label}) also enforced by
   * `boardsmith validate`'s `colorPalette` check — do not diverge from it.
   *
   * Dev (`boardsmith dev`) resolves the effective palette in this order:
   * `gameDefinition.colorPalette` -> `boardsmith.json` `colorPalette` ->
   * the engine's `DEFAULT_COLOR_PALETTE`. `publish` already writes
   * `manifest.colorPalette` from its own source; this field unifies the
   * game-authored declaration so dev matches what publish emits.
   */
  colorPalette?: Array<{ id: string; hex: string; label: string }>;
  /**
   * Optional tutorial definition for this game.
   *
   * Threaded un-serialized (like `bot`) from here into the engine via
   * the `start` op (`executeOp`) → `GameOptions.tutorial` → `Game.tutorialDefinition`.
   * The definition is static config (step ids, gates, reserved content) and
   * must NOT be serialized — mirrors the `_actions` / `bot` pattern.
   */
  tutorial?: TutorialDefinition;
  /**
   * How many per-action undo checkpoints this game retains.
   *
   * A checkpoint is a full copy of the element tree, and one is kept per
   * action. Left unset, that is retained for the life of the game: the tree
   * stops growing, the saved game never does, and every byte of game state is
   * multiplied by the game's total action count. A game with a high action
   * count (18xx, campaign/legacy, worker placement with many small actions)
   * will eventually exceed what its host allows a saved game to be.
   *
   * ```ts
   * checkpoints: { max: 20 }   // keep the 20 most recent; older undos refused
   * checkpoints: { enabled: false }   // no undo, no time-travel, flat size
   * ```
   *
   * `max` must exceed the most actions one seat takes in a single turn — undo
   * restores that seat's turn-start checkpoint. See `docs/state-size.md`.
   */
  checkpoints?: CheckpointPolicy;
  /**
   * What undo is allowed to take back in this game.
   *
   * ```ts
   * undo: { fenceRandomRewind: true }   // a draw, once made, is final
   * ```
   *
   * Set `fenceRandomRewind` on any COMPETITIVE game. Undo already restores the
   * RNG position, so redoing the same action cannot re-roll — but reordering
   * can: undo, act differently first, then draw again on a different generator
   * position. A player alone in a private session can repeat that unobserved
   * until the draw suits them. See `UndoPolicy`.
   */
  undo?: UndoPolicy;
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

// ============================================
// Game State Types
// ============================================

// THE PICK SHAPE IS OWNED BY ../types/protocol.js (#251).
//
// It used to be declared here as well, and a third time in
// ui/composables/useActionControllerTypes.ts, so #249's `orderedList` had to be
// added in three places and the audit reported the result as a 79-line
// unaccepted clone group. The wire module is the one place it belongs: the
// session emits these shapes onto the wire, and the engine now builds them
// from the same declaration.
// Imported locally (so the shapes are usable as types in this module) AND
// re-exported, keeping the protocol layer as the single source of truth.
import type {
  ElementRef,
  ChoiceWithRefs,
  PickFilter,
  PickMetadata,
  ActionMetadata,
  PickChoicesResponse,
  WarningEntry,
} from '../types/protocol.js';
export type {
  ElementRef,
  ChoiceWithRefs,
  PickFilter,
  PickMetadata,
  ActionMetadata,
  PickChoicesResponse,
  WarningEntry,
};

/**
 * A single per-cell entry in the evaluation heatmap.
 *
 * Session-layer only, never serialized. Built from {@link BotMoveStats} by
 * the `heatmapToggle` op — one entry per distinct destination
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
  availableActions: string[];
  isMyTurn: boolean;
  view: unknown;
  /** Action metadata for auto-UI generation (optional) */
  actionMetadata?: Record<string, ActionMetadata>;
  /**
   * The follow-up the flow holds for this seat, with the metadata to start it.
   * Only in this seat's own state, and only while it holds one: the seat keeps
   * its turn (or stays undone in a simultaneous step) until it takes it or takes
   * another action. A client starts it from here when it did not get it in the
   * result of the action that returned it, as after a reload.
   */
  followUp?: FollowUpOffer;
  /** Whether the player can undo (has made actions this turn) */
  canUndo?: boolean;
  /**
   * Number of actions made by this player since turn start -- its OWN actions,
   * never another seat's. There is deliberately no global action count or
   * history index anywhere in this state: in a simultaneous step it would let a
   * seat count another seat's secret actions (#449).
   */
  actionsThisTurn?: number;
  /** Animation events pending playback (from game buffer). Only present when events exist. */
  animationEvents?: AnimationEvent[];
  /** ID of the last animation event, for acknowledgment convenience. Only present when events exist. */
  lastAnimationEventId?: number;
  /** Whether color selection is enabled for this game (from game settings) */
  colorSelectionEnabled?: boolean;
  /** Formatted game messages visible to this player */
  messages?: Array<{ text: string }>;
  /**
   * How many checkpoint RESTORES (undo / rewind / host-driven restore) this
   * game's timeline has undergone (`runner.restoreEpoch`).
   *
   * Published unconditionally for EVERY seat. This is the
   * stated form of "the runner was replaced": a client observing this value
   * CHANGE between two broadcasts knows every element id it captured from the
   * previous runner is stale and must be discarded — an open pick's
   * `validElements`, a drag in progress, any cached element-id list. The
   * session layer clears its own state of exactly that kind at the same moment
   * (the host's hint, heatmap and pending selections on an undo or rewind); this
   * field is how clients get told, and `useAnimationEvents` resets its
   * watermarks on the same change.
   */
  restoreEpoch: number;
  /**
   * Which game this is (`runner.gameInstanceId`, #356).
   *
   * Published unconditionally for EVERY seat, like `restoreEpoch`, and read
   * with it: `restoreEpoch` says the runner of THIS game was replaced, and a
   * change here says the GAME was — New game, a host starting another game
   * under the same page. Every new game starts at epoch 0, so the epoch alone
   * cannot see that, and a client kept offering the previous game's element
   * ids at a step whose action set had not changed.
   */
  gameInstanceId: string;
  /**
   * The seat this state was built for: `0` for a spectator.
   *
   * Published unconditionally, and read with `gameInstanceId` and
   * `restoreEpoch`: each seat numbers the animation events it may see in its
   * own sequence (#489), so an event's `id` means something only beside the
   * seat it was numbered for. A page that changes seat (the dev host's
   * follower, a spectator taking a seat) sees this change, and
   * `useAnimationEvents` starts its watermark again for the new seat's numbers.
   */
  viewerSeat: number;
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
   * Why each disabled action is disabled, for this seat.
   *
   * Maps action name → human-readable reason, covering both sources: the
   * action's own `.disabled(ctx)` rule and the active tutorial step's gate.
   * `undefined` when nothing is disabled.
   *
   * Action availability is otherwise a binary `string[]`; this field carries
   * the "why" so the UI can grey the button out AND say what is missing. An
   * action listed here is still in `availableActions` on purpose — a vanished
   * button teaches the player nothing.
   */
  disabledActions?: Record<string, string>;
  /**
   * Session-layer only, never serialized. Transient move hint annotation for
   * this seat. Present only after the seat's `hint` op
   * and before the next action on that seat or an undo/rewind clears it.
   *
   * Merged into the seat's view by `SnapshotSessionHost.mergeTransientState`.
   */
  hint?: { annotation: Annotation };
  /**
   * Session-layer only, never serialized. Evaluation heatmap for this seat.
   * Present (and updated) while the player has the heatmap overlay toggled on
   * with the `heatmapToggle` op.
   *
   * Merged into the seat's view by `SnapshotSessionHost.mergeTransientState`.
   */
  heatmap?: { visible: boolean; entries: HeatmapEntry[] };
  /**
   * Session-layer only, never serialized. Narration text for the current bot
   * demo move. Present between the host announcing the move and the move
   * broadcasting; `undefined` otherwise.
   *
   * Merged into the seat's view by `SnapshotSessionHost.mergeTransientState`.
   */
  narration?: { text: string };
  /**
   * Session-layer only, never serialized. True while a bot-vs-bot demo is
   * running (a `demoStart` op and no `demoStop` since). Present in
   * broadcast state so all connected clients (including reconnecting windows
   * and second-window scenarios) derive this flag from session truth rather
   * than a local Vue ref that can desync (WR-04).
   *
   * Merged into the seat's view by `SnapshotSessionHost.mergeTransientState`.
   * Absent (undefined) when no demo is running.
   */
  isDemoRunning?: boolean;
  /**
   * Whether the current game definition has a tutorial attached.
   *
   * Set by `buildPlayerState` when `runner.game.tutorialDefinition` is defined.
   * Consumers (GameShell, ControlsMenu) use this to show the "Start tutorial"
   * menu item. Undefined when no tutorial is defined — omitted to keep the
   * wire shape lean (not `false`, just absent).
   */
  hasTutorial?: boolean;
  /**
   * Session-layer only, never serialized. True when the host created this session
   * with `teachingDisabled: true` (LOCK-01). Reflected unconditionally into every
   * broadcast player state so reconnecting clients and second windows derive their
   * gating from session truth rather than a local init message that may not replay.
   *
   * Merged into the seat's view by `SnapshotSessionHost.mergeTransientState` (D-03).
   * Always present (both true and false) so consumers can rely on it without
   * undefined-checks.
   */
  teachingDisabled?: boolean;
  /**
   * Serialized flow-position snapshot, sourced from `Game.getFlowDebugInfo()`.
   *
   * Public flow structure (phase/step/path/awaiting), safe to broadcast to
   * every connected seat and spectators alike (T-123-08 — not per-seat hidden
   * info). `description` is `FlowDebugInfo.describe()`'s output precomputed
   * server-side — `describe()` is a method and does not survive the wire, so
   * it is never sent; only this plain string is.
   *
   * Merged into the seat's view by `SnapshotSessionHost.mergeTransientState`.
   */
  flowDebugInfo?: SerializedFlowDebugInfo;
  /**
   * This seat's OWN pending multi-step action snapshot (or `undefined` when
   * none is in progress).
   *
   * SECURITY: this MUST be sourced per seat (the host keeps each seat's pending
   * state apart) — never a single value shared across seats. A
   * seat must never receive another seat's accumulated pending-action args
   * (T-123-07, the phase's flagged hidden-info leak threat).
   *
   * Merged into the seat's view by `SnapshotSessionHost.mergeTransientState`. Always
   * the JSON-safe serialized form (`SerializedPendingActionState`), never the
   * live engine `PendingActionState` (its `onSelectFired: Set<number>` does
   * not survive `JSON.stringify` — see `serializePendingActionState()` in
   * `session/utils.ts`, CR-01).
   */
  pendingAction?: SerializedPendingActionState;
}

/**
 * Plain-object, wire-safe snapshot of `PendingActionState` (see
 * `engine/action/types.ts`).
 *
 * `PendingActionState.onSelectFired` is a `Set<number>`, which does not
 * survive `JSON.stringify` (`JSON.stringify(new Set([1,2]))` produces `"{}"`).
 * This type replaces it with a plain `number[]`. This is the single shared
 * serialized shape reused by `PickHandler`'s
 * selection-step responses, and `SnapshotSessionHost`/`stateless-ops.ts`'s
 * `debug:flow-state` op — no divergent wire shapes across those channels
 * (CR-01/WR-01).
 */
export interface SerializedPendingActionState {
  actionName: string;
  playerPosition: number;
  collectedArgs: Record<string, unknown>;
  repeating?: {
    selectionName: string;
    accumulated: unknown[];
    iterationCount: number;
  };
  currentSelectionIndex: number;
  onSelectFired?: number[];
  conditionHeld?: boolean;
}

/**
 * Plain-object, wire-safe snapshot of `FlowDebugInfo` (see `engine/flow/types.ts`).
 *
 * `FlowDebugInfo.describe()` is a method and does not survive serialization;
 * this type replaces it with a precomputed `description` string. This is the
 * single shared serialized shape reused by the session broadcast, the
 * `debug:flow-state` dev-host op, and the `__BOARDSMITH_DEVTOOLS` bridge —
 * no divergent structures across those three channels.
 */
export interface SerializedFlowDebugInfo {
  /** Current named phase, read directly from `FlowState.currentPhase`. */
  phase?: string;
  /** Most-specific named node reached by following the flow position's path. */
  step?: string;
  /** Raw index path, for machine consumers that want the exact position. */
  path: number[];
  /** Seat(s) currently awaited, mirrors `FlowState.currentPlayer`/`awaitingPlayers`. */
  awaiting: {
    /** Current player seat if awaiting input (single-player action steps). */
    currentPlayer?: number;
    /** Seats awaiting input (simultaneous action steps). */
    awaitingPlayers?: number[];
  };
  /** Precomputed `FlowDebugInfo.describe()` output, e.g. "phase *pegging* -> step *player-turn*, waiting on seat 2". */
  description: string;
}

// ============================================
// Lobby Types
// ============================================

// Re-export lobby types from canonical source
export type { LobbyState, SlotStatus, LobbySlot, LobbyInfo };

// ============================================
// Session Types
// ============================================

// ============================================
// Bot Types
// ============================================

// ============================================
// Adapter Interfaces
// ============================================

// ============================================
// Request/Response Types
// ============================================

// WebSocketMessage (a discriminated union) is owned by ../types/protocol.js
// (single source of truth) and re-exported here for the session surface.
export type { WebSocketMessage };

// The lobby request and response shapes are owned by ../types/protocol.js
// (#375); the session serves them, so it hands out the protocol's own.
export type { PlayerConfig, CreateGameRequest, ClaimSeatRequest, ClaimSeatResponse, JoinLobbyRequest, JoinLobbyResponse };

// ============================================
// Lobby Request/Response Types
// ============================================

