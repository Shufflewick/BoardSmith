import type { Game, MessageEntry } from '../element/game.js';
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

  /**
   * The game's message log — stored ONCE per snapshot, NOT inside `state`.
   *
   * The log used to ride in the element tree, which meant every retained
   * `ActionCheckpoint` carried its own full copy: persisted state was
   * `(checkpoints.max + 1) x (model + log)`, and the log is the term that never
   * stops growing. Measured on a narration-heavy game it reached 95% of
   * persisted bytes and crossed a 2 MB host ceiling at four seats, with a state
   * model of only 4 KB.
   *
   * As a snapshot-level sibling it is paid for once, so snapshot size is flat in
   * `checkpoints.max` again. Each checkpoint instead carries an
   * `ActionCheckpoint.messageCount` watermark — the log length at that
   * action-count boundary — and `GameRunner.fromCheckpoint` slices this array to
   * it, so undo still drops the lines the undone action wrote.
   *
   * AUDIENCE: this is the UNFILTERED log on every persistence path, and must
   * stay that way — a filtered copy would silently destroy other seats' history
   * on the next restore. The one exception is `createSnapshot`'s `forSeat`
   * redacted-clone path (the MCTS search sandbox), which filters it through the
   * same `messageTo` audience gate that redacts the tree.
   */
  messageLog?: MessageEntry[];

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
   * Monotonic count of CHECKPOINT RESTORES this timeline has undergone
   * (undo / rewind / any future host-driven restore). Bumped in exactly one
   * place — `GameRunner.fromCheckpoint`, the single sanctioned restore site —
   * and carried through `getSnapshot`/`fromSnapshot` so it survives the
   * stateless boundary and a cold restart.
   *
   * This is the DURABLE form of the fact `GameSession`'s `replaceRunner`
   * already acts on locally: after a restore, every element id captured from
   * the old runner is stale. The session clears its own such state (hint,
   * heatmap, pending actions) inline; broadcasting the epoch as
   * `PlayerGameState.restoreEpoch` lets CLIENTS — which hold exactly the same
   * kind of state in an open pick's `validElements` — invalidate theirs from a
   * `!==` comparison instead of deducing it from a rewound `actionCount` (which
   * only ever sees a restore that moves BACKWARD).
   *
   * Absent (older snapshot predating this field): read as `0` — no restore
   * recorded, the honest reading, not a compat shim.
   */
  restoreEpoch?: number;

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
 * A game's declared undo policy — what undo is allowed to take back.
 *
 * Defined here, alongside `CheckpointPolicy`, for the same reason:
 * `GameDefinition.undo` is a field GAMES set, and a published bundle may import
 * only `boardsmith` and `boardsmith/session`. Both re-export it.
 */
export interface UndoPolicy {
  /**
   * Refuse an undo whose span contains a random draw. Default: `false`.
   *
   * Undo already restores the RNG position along with the state, so re-doing
   * the SAME action after an undo cannot re-roll. It is REORDERING that scums:
   * undo, take a different action first, then take the drawing action again,
   * and the draw lands on a different generator position. A player alone in a
   * private session with unlimited undo can repeat that until the draw suits
   * them, and nobody observes it.
   *
   * ```ts
   * import type { UndoPolicy } from 'boardsmith';
   *
   * export const gameDefinition = {
   *   // ...
   *   undo: { fenceRandomRewind: true } satisfies UndoPolicy,
   * };
   * ```
   *
   * Set it on any competitive game — above all a persistent world, where one
   * long-lived shared session IS the world. Each draw then happens exactly once
   * no matter how the actions around it are ordered: reordering BEFORE a draw
   * without observing it carries no advantage (the value depends only on the
   * generator position, which non-drawing actions never move), and observing a
   * draw fences the rewind.
   *
   * Deliberately conservative inside a simultaneous step: another seat's draw
   * since your turn began also fences YOUR undo, because a shared random stream
   * is precisely what must not be rewound underneath the seats that saw it.
   */
  fenceRandomRewind?: boolean;
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

  /**
   * The log's ABSOLUTE length at this action-count boundary — entries ever
   * written, including any since evicted. The watermark that keeps the log
   * undoable without storing it per entry.
   *
   * The log lives once on the enclosing snapshot rather than inside each
   * checkpoint's tree (see `GameStateSnapshot.messageLog`). Undo must still drop
   * the lines the undone action wrote, so `GameRunner.fromCheckpoint` resolves
   * this against `Game#messagesEvicted` to find the boundary in the log as it
   * stands now. A number per checkpoint instead of an array per checkpoint is
   * the whole saving.
   *
   * ABSOLUTE, not the log's current length (#25). It used to be
   * `messages.length`, a prefix watermark over an array the engine assumed was
   * append-only — so a game that pruned its log, as `docs/state-size.md` tells
   * it to, shifted every later index and made every earlier checkpoint name a
   * prefix containing lines written after its boundary and missing lines that
   * existed at it. Counting entries ever written, and tracking how many were
   * evicted, costs one number per GAME rather than an identity on every line —
   * which matters in the one system whose problem is that the log grows.
   *
   * Absent on a checkpoint captured before this field existed: read as "restore
   * the whole log", which is the honest reading of no recorded boundary.
   */
  messageCount?: number;
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
   * Why each disabled action is disabled, for this seat.
   *
   * Maps action name → human-readable reason, from the action's own
   * `.disabled(ctx)` rule or the active tutorial step's gate. `undefined` when
   * nothing is disabled. Mirrors `PlayerGameState.disabledActions` (parity
   * hard-rule).
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
  /** `forSeat`: build a REDACTED clone for this seat — `null` for the spectator
   *  (public information only). Omit for the unfiltered authoritative truth. */
  opts?: { forSeat?: number | null }
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
    // keep seeing the authoritative tree). Opt-in `forSeat` (bot-02): callers
    // that need a per-seat REDACTED clone (the MCTS bot's search sandbox) pass
    // their seat and get `toJSONForPlayer`'s existing redaction instead of
    // inventing a new one. Never flip this default for all callers.
    state: opts?.forSeat !== undefined
      ? game.toJSONForPlayer(opts.forSeat, hiddenIdRemap)
      : game.toJSON(),
    // The log is a snapshot sibling, not part of the tree. It carries the SAME
    // audience gate as `state`: on the default path the unfiltered truth (a
    // persisted snapshot that dropped other seats' lines would destroy their
    // history on restore), and on the `forSeat` redacted-clone path only what
    // that seat may see. Without the second half, the MCTS search sandbox — a
    // clone built precisely so a bot cannot reason over hidden information —
    // would hold every seat's private log.
    messageLog: game.serializeMessageLog(opts?.forSeat),
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
    // A watermark into the snapshot-level log, not a copy of it — see
    // `ActionCheckpoint.messageCount`. This is what keeps undo able to drop the
    // lines an undone action wrote now that the log is stored once, and being
    // ABSOLUTE (entries ever written) is what survives a game pruning the log.
    messageCount: game.messageCount,
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
  // Disabled-action reasons are NOT tutorial-only: an action's own `.disabled()`
  // rule applies in ordinary play, so this is projected for every seated player
  // (spectators have no actions to disable). getDisabledActions returns `{}`
  // when nothing is disabled, which the spread below omits from the wire.
  const disabledActions = playerPosition > 0
    ? game.getDisabledActions(playerPosition)
    : undefined;

  return {
    player: playerPosition,
    state: game.toJSONForPlayer(playerPosition),
    flowState: flowState ? {
      awaitingInput: flowState.awaitingInput,
      isMyTurn,
      availableActions,
    } : undefined,
    // Seat-scoped: `messageTo()` messages addressed to other seats are withheld
    // here, not hidden in the UI — this is the payload the client receives.
    // Keeps each line's game-supplied `type` (#21) — flattening to `{ text }`
    // here was the last hop that dropped it.
    messages: game.getFormattedMessageEntries(playerPosition),
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
  return [...game.all(Player)].map((p) => createPlayerView(game, p.seat));
}
