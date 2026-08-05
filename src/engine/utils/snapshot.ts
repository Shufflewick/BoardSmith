import type { Game } from '../element/game.js';
import { Player } from '../player/player.js';
import type { SerializedAction } from '../action/types.js';
import type { FlowState } from '../flow/types.js';
import type { ElementJSON } from '../element/types.js';
import type { TutorialStepView } from '../tutorial/types.js';
import { getActiveTutorialStepView } from '../tutorial/gate.js';

/**
 * Complete game state snapshot for persistence/transmission
 */
export interface GameStateSnapshot {
  /** Version for compatibility checking */
  version: number;

  /** Game class name for reconstruction */
  gameType: string;

  /** Full element tree state (players are now children in the tree).
   *  This is the exact `game.toJSON()` payload — the same shape consumed by
   *  `loadSerializedState`, so restore is typed end-to-end with no casts. */
  state: ReturnType<Game['toJSON']>;

  /** Flow engine state (if flow is active) */
  flowState?: FlowState;

  /** Action history for replay */
  actionHistory: SerializedAction[];

  /** Random seed for deterministic replay */
  seed?: string;

  /** Element sequence counter (`game._ctx.sequence`) captured at snapshot time.
   *  Restored after the tree is loaded so new-element ids stay aligned between
   *  dev and the executor (mirrors `restoreDevState`). Without this, ids drift
   *  on the next created element and can trip the deletion-detector warning. */
  sequence?: number;

  /** Seeded RNG internal state (`game.getRandomState()`) captured at snapshot
   *  time. Restored via `game.setRandomState()` so the next `game.random()` draw
   *  matches the live game exactly. This is what makes `fromSnapshot` fully
   *  state-authoritative: the RNG position is restored directly instead of being
   *  re-derived by replaying actions. Optional for back-compat with older
   *  snapshots that predate RNG-state capture. */
  randomState?: number;

  /** Original constructor options (for full game restoration including custom options like playerConfigs) */
  gameOptions?: Record<string, unknown>;

  /** Per-action authoritative checkpoints for undo / debug time-travel, as a
   *  RETAINED WINDOW over action counts (see `ActionCheckpointWindow`).
   *  The checkpoint for action count `k` is the LATEST per-action state observed
   *  while `k` actions were recorded — refreshed on every op so trailing
   *  pending/selection mutations (e.g. `Piece.putInto` inside a completed pending
   *  action, recorded in neither command nor action history) are captured at the
   *  right action-count boundary. Undo/rewind restore that entry directly (via
   *  `GameRunner.fromCheckpoint`) instead of replaying history — replay loses those
   *  pending mutations and mis-positions the flow.
   *
   *  Each entry is a LEAN `ActionCheckpoint` carrying only the per-action-varying
   *  state (element tree, flow position, sequence, RNG). The snapshot-wide
   *  invariants (`gameType`, `seed`, `gameOptions`) and the action-history PREFIX
   *  are NOT duplicated per entry — they are rehydrated from the enclosing snapshot
   *  by `GameRunner.fromCheckpoint`. That is what makes a single entry cheap; the
   *  window's `baseIndex` is what bounds HOW MANY are kept. Maintained by
   *  `GameRunner`, never nested. */
  actionCheckpoints?: ActionCheckpointWindow;

  /**
   * The durable execute()-barrier fence (UNDO-02, 155-02): the action-history
   * length at the moment the MOST RECENT `execute()` flow node completed. An
   * undo/rewind targeting `turnStartActionIndex < executeBarrierIndex` must be
   * refused -- it would silently roll back a committed, irreversible side
   * effect (scoring, dealing, revealing hidden info) that `execute()` exists
   * to run.
   *
   * This is the durable REPLACEMENT for `FlowEngine`'s transient
   * `frame.completed` flag (`engine.ts` `executeExecute`): `frame.completed`
   * lives on a flow stack frame that does not survive checkpoint restore (a
   * fresh `FlowEngine` is rebuilt with an empty stack), so it cannot be the
   * fence on its own. `executeBarrierIndex`, by contrast, is a plain number
   * persisted as a snapshot sibling of `actionCheckpoints` and re-adopted on
   * every `fromSnapshot`/`fromCheckpoint` restore -- monotonic within a run,
   * and clamped to the restore point on `fromCheckpoint` (a barrier ahead of
   * the rewound timeline no longer applies to it). Absent (older snapshot
   * predating this field, or a run with no execute() node yet): read as `0`
   * -- the honest reading of "no barrier was ever recorded", not a compat
   * shim (project no-back-compat rule).
   */
  executeBarrierIndex?: number;

  /**
   * CR-02 (159): `originalId -> syntheticId` remap for fungible hidden-zone
   * children anonymized by `toJSONForPlayer` (populated only when `state` was
   * built via the `opts.forSeat` redacted path below). Carried alongside
   * `state`/`flowState` so `restoreGame`/`restoreFlowState` can relink an
   * element-typed flow variable that pointed at a now-hidden element to its
   * correct redacted placeholder instead of leaving a dead serialized marker.
   * Always absent on the default (un-redacted) `createSnapshot` path — those
   * callers keep real ids throughout, so no remap is ever needed.
   */
  hiddenIdRemap?: Map<number, number>;
}

/**
 * How many per-action undo checkpoints a game retains.
 *
 * Each checkpoint is a full copy of the element tree, so the default —
 * retain everything — makes a snapshot grow by one tree per action for the
 * life of the game. The tree stops growing; the snapshot does not. A game
 * with a high action count (18xx, campaign/legacy, worker placement with
 * many small actions) will eventually exceed whatever its host allows a
 * saved game to be.
 *
 * Declare a policy on the game definition to bound it:
 *
 * ```ts
 * import type { CheckpointPolicy } from 'boardsmith';
 *
 * export const gameDefinition = {
 *   // ...
 *   checkpoints: { max: 20 } satisfies CheckpointPolicy,
 * };
 * ```
 *
 * `max` must exceed the most actions ONE SEAT takes in a single turn: undo
 * restores the checkpoint at that seat's turn-start action count, and an undo
 * reaching past the retained window is refused (with a message naming the
 * policy) rather than silently replaying or approximating.
 *
 * Defined here — in the engine — rather than next to `GameRunner`, because
 * `GameDefinition.checkpoints` is a field GAMES set, and a published bundle
 * may import only `boardsmith` and `boardsmith/session`. Both re-export it.
 */
export interface CheckpointPolicy {
  /**
   * Maximum checkpoints retained; the oldest are dropped first.
   * Default: unbounded — retain one per action, forever.
   */
  max?: number;
  /**
   * Capture checkpoints at all. `false` disables undo and debug time-travel
   * entirely, and is the only way to make a game's snapshot size independent
   * of its action count. Default: `true`.
   */
  enabled?: boolean;
}

/**
 * A lean per-action checkpoint for authoritative undo / debug time-travel.
 *
 * Carries ONLY the state that varies per recorded action; the snapshot-wide
 * invariants (`gameType`, `seed`, `gameOptions`, `version`) and the
 * action-history prefix are reconstructed from the enclosing `GameStateSnapshot`
 * when restoring via `GameRunner.fromCheckpoint`. Storing those per entry would
 * make a single snapshot O(N^2) (see `GameStateSnapshot.actionCheckpoints`).
 */
export interface ActionCheckpoint {
  /** Full element tree state at this action-count boundary (`game.toJSON()`). */
  state: ReturnType<Game['toJSON']>;

  /** Flow engine position at this checkpoint (if flow is active). */
  flowState?: FlowState;

  /** Element sequence counter (`game._ctx.sequence`) at this checkpoint. */
  sequence?: number;

  /** Seeded RNG internal state (`game.getRandomState()`) at this checkpoint. */
  randomState?: number;
}

/**
 * The RETAINED WINDOW of per-action checkpoints — a contiguous run of action
 * counts, not the whole history.
 *
 * A checkpoint is a full copy of the element tree, so keeping one per action for
 * the life of a game makes the snapshot `O(actions x treeSize)`: the tree stops
 * growing, the snapshot never does. That is unbounded by default and bounded by
 * a game's `checkpoints: { max }` policy (`GameRunnerOptions`) — the window is
 * how the bound is REPRESENTED, so a pruned snapshot pays nothing at all for the
 * dropped range rather than carrying a hole per action.
 *
 * The window is why `baseIndex` exists instead of a plain array: keeping the
 * array and deleting old slots would leave sparse holes that serialize as
 * `null`, quietly making "pruned by policy" indistinguishable from "never
 * captured" at every restore site — the two need different, actionable errors.
 * Read entries through {@link checkpointAt}, never by raw index arithmetic.
 */
export interface ActionCheckpointWindow {
  /** The action count `entries[0]` was captured at. */
  baseIndex: number;
  /** Checkpoints for action counts `baseIndex` .. `baseIndex + entries.length - 1`. */
  entries: ActionCheckpoint[];
}

/** Why a checkpoint lookup found nothing — the two cases need different errors. */
export type CheckpointAbsence =
  /** Older than the retained window: dropped by the game's `checkpoints.max`. */
  | 'pruned'
  /** Never captured: ahead of the window, or checkpointing is disabled. */
  | 'uncaptured';

/**
 * The checkpoint recorded at action count `index`, or the reason there is none.
 *
 * The single sanctioned reader of an `ActionCheckpointWindow`. Callers that
 * surface a failure must distinguish the two absences: "you undid past the
 * retained window" is a policy outcome the author can change, while "no
 * checkpoint was ever captured here" is a bug or a disabled-checkpoints game.
 */
export function checkpointAt(
  window: ActionCheckpointWindow | undefined,
  index: number,
): { checkpoint: ActionCheckpoint } | { checkpoint: null; absence: CheckpointAbsence } {
  if (!window || window.entries.length === 0) {
    return { checkpoint: null, absence: 'uncaptured' };
  }
  if (index < window.baseIndex) {
    return { checkpoint: null, absence: 'pruned' };
  }
  const entry = window.entries[index - window.baseIndex];
  if (!entry) {
    return { checkpoint: null, absence: 'uncaptured' };
  }
  return { checkpoint: entry };
}

/** How many checkpoints a window retains (0 when absent). */
export function checkpointCount(window: ActionCheckpointWindow | undefined): number {
  return window?.entries.length ?? 0;
}

/**
 * Per-player view of the game state
 */
export interface PlayerStateView {
  /** Player position */
  player: number;

  /** Filtered state (hidden elements obscured) */
  state: ElementJSON;

  /** Flow state relevant to this player */
  flowState?: {
    awaitingInput: boolean;
    isMyTurn: boolean;
    availableActions?: string[];
  };

  /** Messages visible to this player */
  messages: Array<{ text: string; data?: Record<string, unknown> }>;

  /** Game phase */
  phase: string;

  /** Is game complete? */
  complete: boolean;

  /** Winners (if game is complete) */
  winners?: number[];

  /** Static action metadata for the player's available actions (embed/platform
   *  consumers read this; the dev server builds its own via buildPlayerState).
   *  Populated by the executor, not by createPlayerView. */
  actionMetadata?: Record<string, unknown>;

  /**
   * Active tutorial step projected for this player.
   *
   * `undefined` when no tutorial is running for this seat. Mirrors
   * `PlayerGameState.tutorial` (parity hard-rule). Populated by
   * `createPlayerView` when `game.tutorialProgress.get(seat)?.status === 'running'`.
   */
  tutorial?: TutorialStepView;

  /**
   * Action-level gate reasons for this seat.
   *
   * Maps action name → human-readable reason string for actions blocked by the
   * active tutorial step's gate. `undefined` when no tutorial is running.
   * Mirrors `PlayerGameState.disabledActions` (parity hard-rule).
   */
  disabledActions?: Record<string, string>;
}

/**
 * Create a complete game state snapshot
 */
export function createSnapshot(
  game: Game,
  gameType: string,
  actionHistory: SerializedAction[] = [],
  seed?: string,
  opts?: { forSeat?: number }
): GameStateSnapshot {
  const flowState = game.getFlowState();

  // CR-02 (159): only populated on the `forSeat` redacted path — collects the
  // originalId -> syntheticId remap `toJSONForPlayer` produces for anonymized
  // hidden-zone children, so a caller restoring this snapshot can relink an
  // element-typed flow variable pointing at a now-hidden element (see
  // `hiddenIdRemap`'s doc on `GameStateSnapshot`).
  const hiddenIdRemap = opts?.forSeat !== undefined ? new Map<number, number>() : undefined;

  return {
    version: 1,
    gameType,
    // Default: full un-redacted truth (existing callers, e.g. GameRunner, must
    // keep seeing the authoritative tree). Opt-in `forSeat` (AI-02): callers
    // that need a per-seat REDACTED clone (the MCTS bot's search sandbox) pass
    // their seat and get `toJSONForPlayer`'s existing redaction instead of
    // inventing a new one. Never flip this default for all callers.
    state: opts?.forSeat !== undefined
      ? game.toJSONForPlayer(opts.forSeat, hiddenIdRemap)
      : game.toJSON(),
    flowState: flowState ?? undefined,
    actionHistory: [...actionHistory],
    seed,
    sequence: game._ctx.sequence,
    randomState: game.getRandomState(),
    gameOptions: game.getConstructorOptions(),
    ...(hiddenIdRemap && hiddenIdRemap.size > 0 && { hiddenIdRemap }),
  };
}

/**
 * Create a lean per-action checkpoint for authoritative undo / debug time-travel.
 *
 * Captures ONLY the per-action-varying state (element tree, flow position,
 * sequence counter, RNG position). The snapshot-wide invariants and the
 * action-history prefix are rehydrated from the enclosing snapshot by
 * `GameRunner.fromCheckpoint`, so retaining one of these per action costs one
 * TREE per action rather than the tree-plus-history a full `createSnapshot` per
 * entry would cost.
 *
 * "One tree per action" is cheap per entry and expensive in aggregate: it is
 * still a full copy of the game's state for every action ever taken. Read as
 * "resolved", that phrasing is what let a game reach its host's size ceiling
 * unannounced. What actually bounds it is the retained WINDOW
 * (`ActionCheckpointWindow`) and the game's `checkpoints: { max }` policy —
 * see `docs/state-size.md`.
 */
export function createActionCheckpoint(game: Game): ActionCheckpoint {
  const flowState = game.getFlowState();

  return {
    state: game.toJSON(),
    flowState: flowState ?? undefined,
    sequence: game._ctx.sequence,
    randomState: game.getRandomState(),
  };
}

/**
 * Create a player-specific view of the game state
 */
export function createPlayerView(
  game: Game,
  playerPosition: number
): PlayerStateView {
  const flowState = game.getFlowState();

  // Resolve this player's turn status and available actions, handling BOTH
  // sequential action steps (flowState.currentPlayer / flowState.availableActions)
  // and simultaneous action steps (flowState.awaitingPlayers[].availableActions).
  // Mirrors buildPlayerState() and GameShell so host-embedded views (which read
  // this PlayerStateView) match the BoardSmith dev server. Without the
  // awaitingPlayers branch, simultaneous steps (e.g. a "choose your landing"
  // phase) report zero available actions and no action buttons render.
  let isMyTurn = false;
  let availableActions: string[] | undefined;
  if (flowState) {
    const awaiting = flowState.awaitingPlayers;
    if (awaiting && awaiting.length > 0) {
      const entry = awaiting.find(
        (p) => p.playerIndex === playerPosition && !p.completed
      );
      isMyTurn = entry !== undefined;
      availableActions = entry?.availableActions;
    } else {
      isMyTurn = flowState.currentPlayer === playerPosition;
      availableActions =
        flowState.awaitingInput && isMyTurn
          ? flowState.availableActions
          : undefined;
    }
  }

  // Tutorial projection — parity with buildPlayerState (T-104-07).
  // Uses the shared getActiveTutorialStepView helper so this call site and
  // buildPlayerState cannot diverge.
  const tutorial = playerPosition > 0
    ? getActiveTutorialStepView(game, playerPosition)
    : undefined;
  const disabledActions = tutorial !== undefined
    ? game.getTutorialDisabledActions(playerPosition)
    : undefined;

  return {
    player: playerPosition,
    state: game.toJSONForPlayer(playerPosition),
    flowState: flowState ? {
      awaitingInput: flowState.awaitingInput,
      isMyTurn,
      availableActions,
    } : undefined,
    messages: game.getFormattedMessages().map(text => ({ text })),
    phase: game.phase,
    complete: flowState?.complete ?? false,
    winners: flowState?.complete ? game.getWinners().map(p => p.seat) : undefined,
    ...(tutorial !== undefined ? { tutorial } : {}),
    ...(disabledActions !== undefined && Object.keys(disabledActions).length > 0 ? { disabledActions } : {}),
  };
}

/**
 * Create views for all players
 */
export function createAllPlayerViews(game: Game): PlayerStateView[] {
  return (game.all(Player as any) as Player[]).map((p) => createPlayerView(game, p.seat));
}
