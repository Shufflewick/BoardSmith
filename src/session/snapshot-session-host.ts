import type {
  ExecutableOp,
  Op,
  OpFailure,
  OpOfType,
  OpResult,
  OpResultFor,
  OpSuccess,
  ReadOnlyOpType,
  StateEnvelope,
} from './stateless-ops.js';
import { closesSeat, debugOpRefusal, isReadOnlyOp } from './stateless-ops.js';
import type { Annotation, FlowState, GameStateSnapshot } from '../engine/index.js';
import { dueSeats, type SeatActivityState } from '../engine/flow/seat-activity.js';
import { flowBoundaryKey, type BoundaryKeyState } from '../engine/flow/boundary-key.js';
import { stepTimeLimitMs, type StepTimeLimitState } from '../engine/flow/step-time-limit.js';
import { describeMoveForNarration } from './move-summary.js';
import { runsAtOnce, type HostWorkGate } from './host-work-gate.js';
import { StatePushGate } from './state-push-gate.js';
import type { HeatmapEntry, SerializedFlowDebugInfo, SerializedPendingActionState } from './types.js';

export type { Op, OpResult } from './stateless-ops.js';
// The adapter's half of #487: every host that pushes these views keeps one.
export { StatePushGate, type StatePushGateOptions } from './state-push-gate.js';

const MAX_BOT_MOVES = 500;

/**
 * The ops that change the game and run through `executeOp`: every executable
 * op except the read-only ones and the teaching ops, which the host keeps as
 * its own state rather than as a move.
 */
type MutatingOp = Exclude<ExecutableOp, { type: ReadOnlyOpType | 'hint' | 'heatmapToggle' }>;

/**
 * Consecutive persist() failures before `persistenceHealthy` flips false
 * (ERR-03).
 */
const PERSISTENCE_UNHEALTHY_THRESHOLD = 3;

/** A single captured persistence failure. Never carries a stack trace or file paths (T-126-05). */
export interface PersistenceErrorEntry {
  message: string;
  timestamp: number;
}

/**
 * The engine's AUTHORITATIVE answer to "whose move is it, and in which turn?",
 * carried on every broadcast's `meta`.
 *
 * **A consumer must NEVER reconstruct this from a player view.** A per-seat view
 * carries the whole-game `flowState` only because `buildViews` happens to share
 * one object across seats; reading `playerViews[0].flowState` makes that engine
 * internal into an invariant the consumer holds in a comment. Read `meta`.
 * Likewise, never derive "who is up" from `flowState.currentPlayer`: it is
 * `undefined` for the entire life of a simultaneous step, which is how a
 * simultaneous game reported "nobody is up" every round forever (BUG-006).
 */
export interface TurnBoundary {
  /**
   * The identity of the turn/round this broadcast belongs to.
   *
   * **Compared for EQUALITY only.** It is an identity, not an ordering — two
   * different keys tell you the round moved, never which came first. A consumer
   * that needs ordering owns its own monotonic counter (the platform's
   * `turnSeq`) and advances it when this value changes.
   *
   * Equal keys mean the same round, so a re-broadcast (a heatmap toggle, a demo
   * frame, a reconnect) republishes the key unchanged and must not re-stamp a
   * round clock or re-notify a seat. Crucially, the same seats are due on BOTH
   * sides of a real 2-seat simultaneous round boundary, so no comparison of
   * `dueSeats` can substitute for this.
   */
  key: string;
  /**
   * The seats that owe a move right now, in canonical order. Empty in a
   * finished game — nobody owes a move once it is over.
   */
  dueSeats: number[];
  /**
   * How long the open step stays open, in milliseconds, when the step declared
   * a limit (`timeLimitMs` on `actionStep`/`simultaneousActionStep`). Absent
   * when it did not, and in a finished game.
   *
   * A DURATION, never an instant: the engine keeps no clock. It was resolved
   * when the step was entered and is republished unchanged on every broadcast
   * inside the same boundary, so a host arms its deadline once, when `key`
   * changes, from its own clock -- and closes the step when it elapses by
   * submitting the game's `idleAction` for every seat still due, stamped with
   * the `key` it armed under. It does not take part in `key`.
   */
  timeLimitMs?: number;
}

/**
 * Everything a host needs to come back after its process dies, as ONE value.
 * The `persist` adapter receives it, {@link SnapshotSessionHost.durableState}
 * returns it, and {@link SnapshotSessionHost.restore} requires it: store
 * what you were handed and pass it back whole.
 *
 * `snapshot` holds the game, including its flow state and the winners the game
 * declared (#536). Read those with {@link flowStateOf}, {@link isCompleteOf} and
 * {@link winnersOf} rather than storing them a second time: a copy kept beside
 * the snapshot can be saved at a different moment and disagree with it.
 *
 * `pendingStates` is each seat's half-finished multi-step selection, keyed by
 * seat number (a string key, because this value crosses JSON). It is part of
 * the durable state rather than UI state: a repeating selection's picks exist
 * only here, and its `onEach` has already changed `snapshot`, so a snapshot
 * restored without them holds a move that no selection owns (#320).
 */
export interface SnapshotHostState {
  /** The game, or `null` before it has started. */
  snapshot: GameStateSnapshot | null;
  pendingStates: Record<string, Record<string, unknown>>;
}

/** The whole-game flow state of `state`'s snapshot, or `null` before the game has started. */
export function flowStateOf(state: Pick<SnapshotHostState, 'snapshot'>): FlowState | null {
  return state.snapshot?.flowState ?? null;
}

/** Whether `state`'s game has ended. */
export function isCompleteOf(state: Pick<SnapshotHostState, 'snapshot'>): boolean {
  return flowStateOf(state)?.complete ?? false;
}

/**
 * The seats `state`'s game names as winners: empty for a draw or a game still
 * running, unless the game overrides `getWinners()` to name a leader mid-game.
 */
export function winnersOf(state: Pick<SnapshotHostState, 'snapshot'>): number[] {
  return state.snapshot?.winners ?? [];
}

/** Where a snapshot the host is about to hold came from: storage, or an op's answer. */
type SnapshotSource = 'restore' | 'op';

/** How {@link SnapshotSessionHost}'s snapshot check names the snapshot, and what to do about it, per source. */
const SNAPSHOT_SOURCE = {
  restore: {
    missing: 'restore requires the snapshot of a started game. Store the whole value the persist ' +
      'adapter hands you and pass it back; a game that never started has nothing to restore.',
    given: 'restore was given a snapshot',
    remedy: 'The snapshot was not written by this engine; restore what the persist adapter handed you.',
    foreign: 'The persisted state does not belong to this table.',
  },
  op: {
    missing: 'executeOp answered a successful op with no snapshot, so there is no game to publish. ' +
      'Return the snapshot executeOp produced.',
    given: 'executeOp answered with a snapshot',
    remedy: 'The game was built on an engine older than this host (before engine contract r131), or ' +
      'the executeOp adapter changed the snapshot; rebuild the game on this engine.',
    foreign: 'The game named a winner that is not a seat at this table.',
  },
} as const;

/**
 * What became of a game when the rules it runs on were replaced underneath it
 * (`boardsmith dev` reloading a table's rules on a save, #343).
 *
 * - `restored`: the saved state fits the new rules and was kept as it was.
 * - `replayed`: the saved position did not fit (`restoreError` says why), so
 *   the game was rebuilt by replaying its `moves` on the new rules.
 * - `failed`: neither worked, and `reason` says what went wrong with each. The
 *   game cannot go on under these rules.
 */
export type RulesReload =
  | { kind: 'restored'; result: OpSuccess<'start'> }
  | { kind: 'replayed'; restoreError: string; moves: number; result: OpSuccess<'start'> }
  | { kind: 'failed'; reason: string };

/**
 * How a host runs one op: `executeOp` with the game definition and options
 * bound, in process or over a wire. It answers each op with that op's own
 * result ({@link OpResultFor}).
 */
export type ExecuteOpAdapter = <T extends ExecutableOp['type']>(
  snapshot: unknown,
  pendingState: Record<string, unknown> | null,
  op: OpOfType<T>,
) => Promise<OpResultFor<T>>;

/** Every seat's view, and the spectator's, as {@link SnapshotSessionAdapters.record} receives them. */
export interface PublishedViews {
  /** Indexed by seat - 1. */
  players: unknown[];
  /** What a spectator may see, or `undefined` before the first view is built. */
  spectator: unknown;
}

/**
 * Why the host published:
 *
 * - `change`: the game changed (a move, a start, an undo, a rules reload).
 * - `republish`: the game did not change; the host restated it (a hint, a
 *   heatmap, a demo frame, {@link SnapshotSessionHost.broadcastCurrent}).
 * - `restore`: {@link SnapshotSessionHost.restore} brought the host back.
 * - `roster`: {@link SnapshotSessionHost.setBotSeats} changed whether a bot
 *   plays here.
 *
 * Per-change bookkeeping (reporting a turn, say) belongs to `change` only.
 */
export type PublishCause = 'change' | 'republish' | 'restore' | 'roster';

/** A seat a bot plays, and how strongly. */
export interface BotSeat {
  seat: number;
  level?: string;
}

/** What {@link SnapshotSessionHost.restore} takes: the durable state, and what the pages and roster are now. */
export interface HostRestore extends SnapshotHostState {
  /**
   * The views the host last handed `record`, which the pages still show. With
   * them the restore pushes only what differs; without them every seat is
   * pushed its view once, telling it something moved.
   */
  playerViews?: unknown[];
  /** The spectator view the host last handed `record`, likewise. */
  spectatorView?: unknown;
  /**
   * The seats a bot plays now, `[]` when none. Required: a host restored
   * without its roster would publish "no bots", and the `setBotSeats` that
   * corrected it would push every page a second time.
   */
  botSeats: BotSeat[];
}

/** The game's end and turn boundary, handed beside every record and push. */
export interface PublishMeta {
  /** Why this was published. */
  cause: PublishCause;
  isComplete: boolean;
  winners: number[];
  isDraw: boolean;
  turnBoundary: TurnBoundary;
}

export interface SnapshotSessionAdapters {
  playerCount: number;
  executeOp: ExecuteOpAdapter;
  /**
   * THE STATE OF RECORD, after every publish: every seat's view, indexed by
   * seat - 1 (`players[0]` is seat 1), and the spectator's, with the turn
   * boundary and the game's end. Serve a page that connects or reconnects from
   * these, and do any per-change bookkeeping here when `meta.cause` is
   * `change` (it is called even when no seat's view changed). This is not a
   * push: nothing here should reach a page that is already showing the game.
   * It may call {@link SnapshotSessionHost.setBotSeats}; that publish follows
   * this one's push.
   */
  record: (views: PublishedViews, meta: PublishMeta) => void;
  /**
   * PUSH these views: only the seats whose view changed since they were last
   * pushed (`seat` 0 is the spectators), in seat order, never empty. Send each
   * to every page showing that seat, stamping whatever you stamp per push (a
   * send time) here and not before.
   *
   * The host compares the views itself (#487), so a plain loop over `changed`
   * is correct: in a simultaneous step with secret moves, a seat whose view
   * did not change is not in the list, and is not told that another seat
   * acted.
   */
  push: (changed: ReadonlyArray<{ seat: number; view: unknown }>, meta: PublishMeta) => void;
  /**
   * When true, demoStart is rejected fail-loud and state.teachingDisabled is broadcast
   * as true to every seat. Set once at session creation; never toggled mid-session.
   */
  teachingDisabled?: boolean;
  /**
   * When true, the debug ops (`DEBUG_OP_TYPES`) run; otherwise `handleOp`
   * refuses every one of them (#481). Even with debugging on, an op that
   * reports a seat's view runs only for the seat that asked for it. Read on
   * every op, so a host whose answer changes mid-game (the dev host, as people
   * join and leave seats) supplies a getter. The `executeOp`
   * adapter must pass the same answer to `executeOp`'s `hostOptions.debug`,
   * which refuses debug ops on its own.
   */
  debug?: boolean;
  /**
   * Called after every state-mutating op with the host's whole durable state.
   * Store it as given; {@link SnapshotSessionHost.restore} takes it back.
   */
  persist?: (state: SnapshotHostState) => void | Promise<void>;
  /**
   * Injectable hook invoked whenever `persist()` fails (ERR-03). Never
   * rethrown — a throwing hook is swallowed and echoed via `console.error`
   * so it can never crash gameplay (T-126-06).
   *
   * @param error Sanitized `{message, timestamp}` — never a stack trace (T-126-05).
   * @param consecutiveFailures Running count of consecutive persist failures.
   * @param healthy Current `persistenceHealthy` value, so consumers can
   *   escalate severity without recomputing it themselves.
   */
  onPersistenceError?: (error: PersistenceErrorEntry, consecutiveFailures: number, healthy: boolean) => void;
  /**
   * Optional narrator hook for game authors.
   *
   * Supplying this hook is required for hidden-information games: the default
   * narration only includes destination-like args (to, destination, target,
   * square, cell, position) and omits all other args (e.g. card element IDs)
   * that must not be broadcast to every seat on a LAN multiplayer session.
   *
   * Open-information games do not need this hook — the destination-only default
   * is sufficient and safe.
   *
   * @param player - 1-based seat index of the acting player
   * @param action - action name (e.g. "playCard")
   * @param args   - full action args from botSuggest (may contain hidden data)
   * @returns      a narration string safe to broadcast to all seats
   */
  narrateMove?: (player: number, action: string, args: Record<string, unknown>) => string;
  /**
   * How the host holds the work this session starts itself while the rules it
   * runs on are being replaced (#388). Each demo move goes through it, and a
   * chain of bot moves stops between moves while a reload is pending and
   * carries on once it has settled. Without one, that work runs as it comes due.
   */
  hostWork?: HostWorkGate;
}

/**
 * Every field {@link SnapshotSessionHost}'s merge writes into a view from the
 * host's own state (its roster, teaching tools, demo, pending selections),
 * rather than from the game. `flowDebugInfo` is not one: it describes the game
 * the view was built from.
 */
const HOST_STATE_FIELDS = [
  'hint',
  'heatmap',
  'narration',
  'pendingAction',
  'isDemoRunning',
  'demoControls',
  'hasBotPlayers',
  'teachingDisabled',
] as const;

/** `state` without {@link HOST_STATE_FIELDS}; `state` itself when it carries none. */
function withoutHostState(state: Record<string, unknown>): Record<string, unknown> {
  if (!HOST_STATE_FIELDS.some((field) => field in state)) return state;
  const stripped = { ...state };
  for (const field of HOST_STATE_FIELDS) delete stripped[field];
  return stripped;
}

export class SnapshotSessionHost {
  // The game, exposed read-only: the only way in from outside is `restore()`,
  // which checks the snapshot carries its flow state and winners. The flow
  // state, the outcome and the turn boundary are all read out of it (#536).
  private _snapshot: GameStateSnapshot | null = null;

  /** The authoritative game snapshot. Restore it via {@link restore}. */
  get snapshot(): GameStateSnapshot | null {
    return this._snapshot;
  }

  /** The whole-game flow state inside {@link snapshot}. */
  get flowState(): FlowState | null {
    return flowStateOf(this);
  }

  /** Whether the game has ended. */
  get isComplete(): boolean {
    return isCompleteOf(this);
  }

  /** The winning seats the game has declared; empty for a draw. */
  get winners(): number[] {
    return winnersOf(this);
  }

  private pendingStates = new Map<number, Record<string, unknown>>();
  /**
   * The seats a bot plays, as {@link setBotSeats} last stated them (#537). The
   * host owns this copy, so it always knows what its views say about bots.
   *
   * NAMED for bots, like every other bot-facing name in this engine. The
   * automaton is a BOT, not an AI: it is a search algorithm, and calling it AI
   * invites a reader to think of an LLM (ShufflewickPub issue #28). The rename
   * is total (engine contract revision 16): a translation point that reads
   * `isBot` on one side and writes `ai*` on the other is a regression.
   */
  private botSeats: BotSeat[] = [];
  private botPumpRunning = false;
  /**
   * Bot seats that could not act at one game state: their move was refused, or
   * they found none (#421). Nothing about the game changes when that happens,
   * so asking the same seat again at the same state gets the same answer, and a
   * driver that keeps asking is a loop. The pump skips these seats until the
   * snapshot is a different one, and every other bot seat still moves.
   */
  private botSeatsHeldBack: { snapshot: unknown; seats: Set<number> } | null = null;

  /**
   * Serialization chain for state-MUTATING op sequences (dev-host-bot-op-race #1
   * fix). A human action/selection (executeOp → apply → trailing bot pump) and
   * every externally-triggered runBotTurns run to completion before the next
   * begins. Without this, a human op arriving during the bot pump's think-time
   * reads the same base snapshot and last-write-wins silently clobbers the
   * other's move — the intermittent dev-host lost-update wedge. Read-only and
   * teaching ops stay off the chain (they never write the game snapshot).
   */
  private opChain: Promise<unknown> = Promise.resolve();

  // Persistence health (ERR-03): see lastPersistenceError / persistenceHealthy.
  private lastPersistenceErrorEntry: PersistenceErrorEntry | null = null;
  private persistenceConsecutiveFailures = 0;

  // Transient teaching state — persists between ops, merged into every seat's
  // view after the executor built it (mergeTransientState).
  transientTeachingState = new Map<number, {
    hint?: { annotation: Annotation };
    heatmap?: { visible: boolean; entries: HeatmapEntry[] };
  }>();
  demoRunning = false;
  narrationText: string | null = null;
  private lastPlayerViews: unknown[] = [];
  private lastSpectatorView: unknown = undefined;
  /**
   * What each seat (0 = spectators) was last pushed (#487). A view identical
   * to it is not pushed: in a simultaneous step with secret moves, that push
   * would tell the seat another seat acted.
   */
  private readonly pushGate = new StatePushGate<number, { view: unknown }>({
    playerState: (frame) => (frame.view as { state?: unknown } | null | undefined)?.state,
  });
  /** True while {@link publish} runs; a publish asked for meanwhile waits in {@link deferredPublish}. */
  private publishing = false;
  /** The cause of a publish asked for while another was running, to run once it ends. */
  private deferredPublish: PublishCause | null = null;

  // ENDGAME-02 / F-12: once disposed, this host is a DEAD session — it must
  // never broadcast again (a stale `complete`/demo frame from a restarted-away
  // game could resurrect the GameOverCard on the fresh game, or two overlapping
  // sessions could both broadcast). `dispose()` aborts any in-flight demo loop
  // (clearing its timer) and latches this flag so every broadcast path no-ops.
  private disposed = false;

  /**
   * Tear down this session: abort the fire-and-forget demo loop (clearing its
   * pending timer per the CLAUDE.md no-leaked-timers rule) and latch `disposed`
   * so no further state is broadcast from this dead game (F-12).
   */
  dispose(): void {
    this.disposed = true;
    this.stopDemo();
  }

  // Flow-debug snapshot (FLOW-01/03): computed by the pure executor's
  // stateEnvelope() (shared serializeFlowDebugInfo — same wire shape as the
  // debug:flow-state op) and carried forward
  // here so demo/control broadcasts (which re-broadcast lastPlayerViews via
  // broadcastCurrent(), not a fresh executeOp result) still show the last
  // known flow position. Public game structure (T-123-08) — safe to share
  // across every seat/spectator, unlike pendingAction below.
  private lastFlowDebugInfo: SerializedFlowDebugInfo | null = null;

  // Demo loop cancellation flag, move cap, and cancellable-delay handle.
  // demoAbort: set by demoStop to cancel the in-flight runDemoLoop.
  // MAX_DEMO_MOVES: hard cap to guard against infinite/very long games (STRIDE T-110-06).
  // _demoDelayCancel: invoke to clear the pending setTimeout and resolve the delay
  //   promise synchronously — guarantees no timer survives after demoStop (CLAUDE.md).
  private demoAbort = false;
  private readonly MAX_DEMO_MOVES = 200;

  // ── Live demo playback controls (issue R-09) ───────────────────────────────
  // demoDelay: inter-move pacing in ms (speed control; mutable mid-run).
  // demoPaused: when true the loop parks at the pace-gate instead of advancing.
  // demoStepConsume: one-shot — released the gate for a single move; re-pauses after.
  // demoRewound: set by 'back' — tells the loop to re-suggest from the restored
  //   snapshot instead of executing the now-stale narrated move.
  // demoHistory: pre-move snapshots so 'back' can rewind one move at a time.
  // _demoWake: resolves the current pace-gate wait (woken by any control op / stop).
  private demoDelay = 1200;
  private demoPaused = false;
  private demoStepConsume = false;
  private demoRewound = false;
  private demoHistory: unknown[] = [];
  private _demoWake: (() => void) | null = null;

  /** Cancel the demo loop; its `finally` broadcasts that it has stopped. */
  private stopDemo(): void {
    this.demoAbort = true;
    // CR-01: clear narration immediately so any apply() broadcast during the
    // stop window does not inject stale narration text into all clients' views.
    this.narrationText = null;
    // CR-02: wake the pace-gate synchronously so its timer (if any) is cleared and
    // the loop continuation is scheduled as a microtask — the finally block then
    // runs (demoRunning=false + broadcastCurrent) without waiting for the timer.
    // Guarantees no timer survives after demoStop (CLAUDE.md timer-leak rule).
    this.wakeDemo();
  }

  // Re-evaluate the pace-gate. Does NOT null _demoWake — the gate's own finish()
  // clears it when it actually resolves. (Nulling here would mean: after a 'pause'
  // re-parks the gate, the next 'play'/'step' wake finds null and no-ops, freezing
  // the demo — the gate could never be re-armed.)
  private wakeDemo(): void {
    this._demoWake?.();
  }

  private readonly hostWork: HostWorkGate;

  constructor(private readonly adapters: SnapshotSessionAdapters) {
    this.hostWork = adapters.hostWork ?? runsAtOnce;
  }

  /**
   * Most recent sanitized persist() failure (ERR-03), or `null` if no persist
   * has ever failed. Never contains a stack trace or file paths (T-126-05).
   */
  get lastPersistenceError(): PersistenceErrorEntry | null {
    return this.lastPersistenceErrorEntry;
  }

  /**
   * `false` once `PERSISTENCE_UNHEALTHY_THRESHOLD` consecutive persist()
   * calls have failed; recovers to `true` on the very next success. Stays
   * `true` forever when no `persist` adapter is configured (the dev host's
   * default — apply()'s guard makes persistSafely a no-op in that case).
   *
   * Best-effort under concurrent callers (WR-01): `persistenceConsecutiveFailures`
   * is incremented/reset around an unguarded `await op()` with no serialization
   * queue, so if two `persistSafely` calls are ever in flight concurrently for the
   * same host, a failing save's increment can be raced by an overlapping
   * successful save's reset (or vice versa). In practice every known call site
   * awaits `persistSafely` sequentially within a single op, so this is a
   * documented limitation rather than an observed bug — not exact under a
   * hypothetical caller that overlaps saves for the same session.
   */
  get persistenceHealthy(): boolean {
    return this.persistenceConsecutiveFailures < PERSISTENCE_UNHEALTHY_THRESHOLD;
  }

  /**
   * Runs `adapters.persist()` without ever letting it crash the caller
   * (ERR-03 / T-126-03).
   * On success, resets the consecutive-failure counter. On failure,
   * increments it, records a sanitized lastPersistenceError, echoes via
   * console.error, and invokes onPersistenceError (itself guarded so a
   * throwing hook can never crash gameplay — T-126-06). No-ops entirely
   * when no persist adapter is configured.
   */
  // NOTE (WR-01): no serialization guard around the counter increment/reset —
  // see the `persistenceHealthy` doc comment for the concurrency caveat.
  private async persistSafely(op: () => void | Promise<void>): Promise<void> {
    try {
      await op();
      this.persistenceConsecutiveFailures = 0;
    } catch (error) {
      this.persistenceConsecutiveFailures++;
      const entry: PersistenceErrorEntry = {
        message: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
      this.lastPersistenceErrorEntry = entry;
      console.error(
        `[SnapshotSessionHost] persist failed (${this.persistenceConsecutiveFailures} consecutive): ${entry.message}`
      );
      try {
        this.adapters.onPersistenceError?.(entry, this.persistenceConsecutiveFailures, this.persistenceHealthy);
      } catch (hookError) {
        console.error(
          `[SnapshotSessionHost] onPersistenceError hook threw: ${hookError instanceof Error ? hookError.message : String(hookError)}`
        );
      }
    }
  }

  /**
   * Merge transient teaching state — plus the flow-debug/pending-action
   * introspection fields (FLOW-01/03) — into player views post-buildPlayerState.
   *
   * Every field the host writes ({@link HOST_STATE_FIELDS}) is stated afresh,
   * never only added, so a view that already carries them (one handed back to
   * restore) cannot keep a value the host no longer holds.
   *
   * Per-seat: hint, heatmap, pendingAction (keyed strictly by seat = i+1; no
   * cross-seat leak — T-123-07). Game-wide: narration, isDemoRunning,
   * hasBotPlayers, flowDebugInfo (public flow structure, safe for every seat
   * and spectator — T-123-08).
   */
  private mergeTransientState(playerViews: unknown[]): unknown[] {
    return playerViews.map((view, i) => this.mergeView(view, i + 1));
  }

  /** {@link mergeTransientState} for one view: `seat` 0 is the spectator, who has no per-seat state. */
  private mergeView(view: unknown, seat: number): unknown {
    // Guard: stub/empty views (e.g. from bot pump tests) pass through unchanged.
    if (view == null || typeof view !== 'object' || !('state' in view)) return view;
    const withState = view as { state: Record<string, unknown> };
    // A view handed to restore was merged by the host that recorded it, so
    // what it says of the host is as old as that host: drop it and say it again.
    // Every view is merged, never passed through: a view merged by a host with
    // transient state and one passed through by a host without it would differ
    // (`teachingDisabled`), so a restored host would push every page a view
    // that did not change.
    const fromGame = withoutHostState(withState.state);
    const state = { ...fromGame };
    const transient = this.transientTeachingState.get(seat);
    if (transient?.hint) state.hint = transient.hint;
    if (transient?.heatmap) state.heatmap = transient.heatmap;
    if (this.narrationText) state.narration = { text: this.narrationText };
    // Flow position is public game structure — shared across every seat.
    if (this.lastFlowDebugInfo) state.flowDebugInfo = this.lastFlowDebugInfo;
    // SECURITY (T-123-07): pendingAction MUST be looked up keyed on THIS seat
    // only — never shared across seats. A seat must never receive another
    // seat's accumulated pending-action args.
    const pendingAction = this.pendingStates.get(seat);
    if (pendingAction) state.pendingAction = pendingAction as unknown as SerializedPendingActionState;
    if (this.demoRunning) {
      state.isDemoRunning = true;
      // Playback-control state so clients can render the demo control bar.
      state.demoControls = {
        paused: this.demoPaused,
        delay: this.demoDelay,
        canStepBack: this.demoHistory.length > 0,
      };
    }
    if (this.hasBotPlayers()) state.hasBotPlayers = true;
    // Always inject teachingDisabled (true or false) so every broadcast carries the
    // authoritative session value regardless of other transient state (criterion 4).
    state.teachingDisabled = this.adapters.teachingDisabled ?? false;
    return { ...withState, state };
  }

  private hasBotPlayers(): boolean {
    return this.botSeats.length > 0;
  }

  /**
   * State the seats a bot plays now: call it whenever the roster changes (a
   * seat passes between a person and the bot), and wherever anything a derived
   * roster depends on changes. Calling it with the same answer is free.
   *
   * The bot pump, `convertSeatToBot` and the demo read this list. When it
   * changes whether a bot plays here (`hasBotPlayers` in every view), the host
   * publishes at once with cause `roster`: left for the next move to carry,
   * the change would reach a seat whose view nothing else changed exactly when
   * another seat moved in secret (#487). Before the game starts there is
   * nothing to republish; `start()` publishes with this roster.
   *
   * It does not wake the bot pump: send `convertSeatToBot` for that.
   */
  setBotSeats(seats: ReadonlyArray<BotSeat>): void {
    const hadBots = this.hasBotPlayers();
    this.botSeats = seats.map((s) => ({ ...s }));
    if (this.hasBotPlayers() === hadBots || this._snapshot === null || this.disposed) return;
    this.publish('roster');
  }

  /**
   * Re-broadcast the last player views with the current transient teaching state
   * merged in, with cause `republish`: the game did not change. Used for
   * hint/heatmap/demo changes that do not run an op through executeOp.
   */
  broadcastCurrent(): void {
    if (this.disposed) return; // F-12: a dead session never broadcasts.
    this.publish('republish');
  }

  /**
   * Hand the adapter the views of record, then push the ones that changed
   * (#487). Every publish ends here, so no view reaches a page any other way.
   *
   * A publish asked for from inside the adapters (a `record` that calls
   * `setBotSeats`) runs once this one has pushed: run in the middle, it would
   * push its views first and this publish would then push older ones.
   */
  private publish(cause: PublishCause): void {
    if (this.publishing) {
      this.deferredPublish = cause;
      return;
    }
    this.publishing = true;
    try {
      this.publishNow(cause);
    } finally {
      this.publishing = false;
    }
    const deferred = this.deferredPublish;
    this.deferredPublish = null;
    if (deferred !== null && !this.disposed) this.publish(deferred);
  }

  private publishNow(cause: PublishCause): void {
    const meta: PublishMeta = {
      cause,
      isComplete: this.isComplete,
      winners: this.winners,
      isDraw: this.isComplete && this.winners.length === 0,
      turnBoundary: this.turnBoundary(),
    };
    const views = this.mergedViews();
    this.adapters.record(views, meta);
    const changed: Array<{ seat: number; view: unknown }> = [];
    views.players.forEach((view, i) => {
      if (this.pushGate.shouldPush(i + 1, { view })) changed.push({ seat: i + 1, view });
    });
    if (views.spectator !== undefined && this.pushGate.shouldPush(0, { view: views.spectator })) {
      changed.unshift({ seat: 0, view: views.spectator });
    }
    if (changed.length > 0) this.adapters.push(changed, meta);
  }

  /** Every view of record with the host's transient state merged in. */
  private mergedViews(): PublishedViews {
    return {
      players: this.mergeTransientState(this.lastPlayerViews),
      spectator: this.lastSpectatorView === undefined ? undefined : this.mergeView(this.lastSpectatorView, 0),
    };
  }

  /**
   * The host's whole durable state -- the same value the `persist` adapter is
   * handed. For a platform that persists at moments of its own (a roster
   * change, say) as well as from the adapter.
   */
  durableState(): SnapshotHostState {
    return {
      snapshot: this._snapshot,
      pendingStates: Object.fromEntries(this.pendingStates),
    };
  }

  /**
   * Build a host from persisted state after its process died (a Durable Object
   * eviction, a worker restart), and publish it once with cause `restore`.
   * Takes the {@link SnapshotHostState} WHOLE:
   *
   * - `snapshot` must carry its flow state and its winners. Without the flow
   *   state the host would answer "who owes a move?" with the empty set and
   *   broadcast that as the truth; without the winners a finished game would be
   *   published with no outcome (#490).
   * - `pendingStates` is each seat's in-progress selection, captured with that
   *   snapshot. Without it a player who paused mid-action loses their picks,
   *   and a repeating selection's `onEach` moves stay on the board with no
   *   action left to finish (#320).
   *
   * The views given ({@link HostRestore.playerViews}) are taken as what every
   * page already shows, so the publish pushes only what differs from them (a
   * seat that passed between a person and the bot while the host slept), and
   * nothing when nothing does (#487).
   */
  static restore(adapters: SnapshotSessionAdapters, state: HostRestore): SnapshotSessionHost {
    const host = new SnapshotSessionHost(adapters);
    const snapshot = host.checkedSnapshot(state.snapshot, 'restore');
    host.pendingStates = host.restorablePendingStates(state.pendingStates);
    host._snapshot = snapshot;
    host.botSeats = state.botSeats.map((s) => ({ ...s }));
    if (state.playerViews) host.lastPlayerViews = state.playerViews;
    if (state.spectatorView !== undefined) host.lastSpectatorView = state.spectatorView;
    // The gate holds the views exactly as given: they are what the pages show.
    // Merging this host's roster and pending selections into them first would
    // record a change made while the host slept as already sent.
    state.playerViews?.forEach((view, i) => host.pushGate.recordSent(i + 1, { view }));
    if (state.spectatorView !== undefined) host.pushGate.recordSent(0, { view: state.spectatorView });
    host.publish('restore');
    return host;
  }

  /**
   * The check every snapshot passes before the host holds it, from `restore`
   * or from an op's answer: a started game carrying its flow state and its
   * winners, and winners that are seats of this table. Without the flow state
   * the host would publish "nobody owes a move"; without the winners a won game
   * would be published as a draw. Winners in a game that has not ended are
   * taken as they are: a game that overrides `getWinners()` to name the leader
   * while play goes on reports exactly that, and `restore` accepts anything
   * `durableState()` can return.
   */
  private checkedSnapshot(snapshot: unknown, source: SnapshotSource): GameStateSnapshot {
    const say = SNAPSHOT_SOURCE[source];
    if (snapshot === null || typeof snapshot !== 'object') throw new Error(say.missing);
    const { flowState, winners } = snapshot as Partial<GameStateSnapshot>;
    if (flowState === null || typeof flowState !== 'object') {
      throw new Error(
        `${say.given} without its flow state: without it the host cannot say which seats owe a ` +
          `move, and would broadcast an empty due-seat set as the answer. ${say.remedy}`,
      );
    }
    if (!Array.isArray(winners)) {
      throw new Error(
        `${say.given} without its winners (an empty array when no winner is declared): without ` +
          `them a won game would be published as a draw. ${say.remedy}`,
      );
    }
    for (const seat of winners) {
      if (!Number.isInteger(seat) || seat < 1 || seat > this.adapters.playerCount) {
        throw new Error(
          `${say.given} naming winner ${JSON.stringify(seat)}, but this table has seats ` +
            `1 to ${this.adapters.playerCount}. ${say.foreign}`,
        );
      }
    }
    return snapshot as GameStateSnapshot;
  }

  /** `restore`'s check that every pending selection names a seat of this table. */
  private restorablePendingStates(
    pendingStates: SnapshotHostState['pendingStates'] | undefined,
  ): Map<number, Record<string, unknown>> {
    if (pendingStates === null || typeof pendingStates !== 'object') {
      throw new Error(
        'restore requires the pendingStates that were persisted with this snapshot (an ' +
          'empty object when no seat was mid-action). Store the whole value the persist ' +
          'adapter hands you and pass it back.',
      );
    }
    const restored = new Map<number, Record<string, unknown>>();
    for (const [key, pending] of Object.entries(pendingStates)) {
      const seat = Number(key);
      if (!Number.isInteger(seat) || String(seat) !== key || seat < 1 || seat > this.adapters.playerCount) {
        throw new Error(
          `restore was given a pending selection for seat "${key}", but this table has seats ` +
            `1 to ${this.adapters.playerCount}. The persisted state does not belong to this table.`,
        );
      }
      restored.set(seat, pending);
    }
    return restored;
  }

  /**
   * The engine answering its own question, from the flow state it already holds.
   * ONE expression, used at both broadcast construction sites: `apply()` assigns
   * `this._snapshot` BEFORE it broadcasts, so a re-broadcast necessarily
   * republishes the identical boundary rather than minting a new one.
   *
   * Routed through `dueSeats` / `flowBoundaryKey` / `stepTimeLimitMs` — never a
   * second predicate.
   */
  private turnBoundary(): TurnBoundary {
    // A finished game has no seats that owe a move. `dueSeats` already returns
    // [] for a completed flow (it is not awaiting input); this is belt-and-braces
    // for a flow state that is complete while still awaiting input.
    const flowState = this.flowState;
    const timeLimitMs = this.isComplete
      ? undefined
      : stepTimeLimitMs(flowState as StepTimeLimitState | null);
    return {
      key: flowBoundaryKey(flowState as BoundaryKeyState | null),
      dueSeats: this.isComplete ? [] : dueSeats(flowState as SeatActivityState | null),
      ...(timeLimitMs === undefined ? {} : { timeLimitMs }),
    };
  }

  /**
   * Hold the game `res` returned, publish it, and persist it. `pending` is the
   * acting `seat`'s half-made selection after the op: `null` drops it.
   */
  private async apply(res: StateEnvelope, seat?: number, pending: Record<string, unknown> | null = null): Promise<void> {
    this._snapshot = this.checkedSnapshot(res.snapshot, 'op');
    // FLOW-01/03: every state-mutating op's stateEnvelope() carries a fresh
    // flowDebugInfo (shared serializeFlowDebugInfo — same shape as the
    // debug:flow-state op). Carry it forward
    // so demo/control re-broadcasts (broadcastCurrent(), no fresh op result)
    // still show the last known flow position.
    this.lastFlowDebugInfo = res.flowDebugInfo;
    if (seat !== undefined) {
      if (pending) this.pendingStates.set(seat, pending);
      else this.pendingStates.delete(seat);
    }
    this.lastPlayerViews = res.playerViews;
    this.lastSpectatorView = res.spectatorView;
    if (this.disposed) return; // F-12: a dead session never broadcasts.
    this.publish('change');
    await this.persistDurableState();
  }

  /**
   * Hand the whole durable state to the `persist` adapter. Routed through
   * persistSafely (ERR-03): a persist() failure must never throw out of an op
   * and must be observable via onPersistenceError / lastPersistenceError /
   * persistenceHealthy. No-op when no persist adapter is configured (the dev
   * host's default today).
   */
  private async persistDurableState(): Promise<void> {
    if (this.adapters.persist) {
      const persist = this.adapters.persist;
      await this.persistSafely(() => persist(this.durableState()));
    }
  }

  async start(): Promise<void> {
    const res = await this.adapters.executeOp(null, null, { type: 'start' });
    if (!res.success) throw new Error(res.error);
    await this.apply(res);
  }

  /**
   * Run `op` for `seat` and answer with that op's own result. Read-only ops
   * (a choices query, the read-only debug ops) do NOT mutate or broadcast.
   * State-mutating ops broadcast the new state, THEN resolve.
   */
  async handleOp<T extends Op['type']>(seat: number, op: OpOfType<T>): Promise<OpResultFor<T>> {
    // `handle` answers each op from the branch that matched its type. TypeScript
    // narrows `op` there but cannot carry that back to a generic return type,
    // so it is stated here, once.
    return (await this.handle(seat, op)) as OpResultFor<T>;
  }

  private async handle(seat: number, op: Op): Promise<OpResult> {
    // #481: debug ops need debugging on, and a seat-view one must be for `seat`.
    const debugRefused = debugOpRefusal(op, this.adapters.debug === true, seat);
    if (debugRefused) return debugRefused;
    // Demo lifecycle ops — handled directly in the host (NOT delegated to executeOp)
    // because they need the broadcast adapter and a cancellable async lifetime.
    // demoStart: fire-and-forget runDemoLoop; return minimal envelope immediately.
    // demoStop: set demoAbort flag; the loop's finally block broadcasts cleanup.
    if (op.type === 'demoStart') {
      // Fail-loud: teaching features locked out by the host.
      if (this.adapters.teachingDisabled) {
        throw new Error('Teaching features are disabled for this session.');
      }
      if (!this.demoRunning) {
        // Build allSeats from all player seats. If botSeats is configured, use
        // the first seat's level as the difficulty for all seats.
        const allSeats = Array.from({ length: this.adapters.playerCount }, (_, i) => ({
          seat: i + 1,
          level: this.botSeats[0]?.level,
        }));
        // Reset playback controls for a fresh run.
        this.demoDelay = typeof op.delay === 'number' ? op.delay : 1200;
        this.demoPaused = false;
        this.demoStepConsume = false;
        this.demoRewound = false;
        this.demoHistory = [];
        void this.runDemoLoop(allSeats); // fire-and-forget
      }
      // Clients read demo state from the broadcasts (RESEARCH Pitfall 7).
      return { success: true };
    }
    if (op.type === 'demoStop') {
      this.stopDemo();
      // Broadcast the clean state (narration cleared, still shows isDemoRunning=true
      // until the finally block fires in the next microtask drain).
      this.broadcastCurrent();
      return { success: true };
    }
    if (op.type === 'demoControl') {
      // No-op if no demo is running (the control bar only renders while running).
      if (this.demoRunning) {
        if (typeof op.delay === 'number') this.demoDelay = op.delay;
        switch (op.control) {
          case 'pause':
            this.demoPaused = true;
            break;
          case 'play':
            this.demoPaused = false;
            this.demoStepConsume = false;
            break;
          case 'step':
            // Advance exactly one move, then re-pause: release the gate once.
            this.demoPaused = true;
            this.demoStepConsume = true;
            break;
          case 'back':
            // Rewind one move: restore the pre-move snapshot and re-suggest from it.
            // On the op chain, like the demo's own moves, so it never lands
            // between a move's execute and its apply.
            await this.enqueue(() => this.demoRewindOne());
            break;
        }
        // Wake the pace-gate so the control takes effect immediately (pause cancels a
        // pending delay; play/step release it; speed re-arms with the new delay).
        this.wakeDemo();
        this.broadcastCurrent();
      }
      return { success: true };
    }

    // convertSeatToBot: also a host lifecycle op — it needs the pump, which the
    // stateless executor does not have. Unlike the demo ops it is ENQUEUED on
    // opChain, because it drives the bot pump and must not interleave with an
    // in-flight human op reading the same base snapshot.
    if (op.type === 'convertSeatToBot') {
      return this.enqueue(() => this.applyConvertSeatToBot(op.seat));
    }

    // Teaching ops (hint / heatmapToggle): compute annotation, store in
    // transient state, re-broadcast via broadcastCurrent() — NOT apply() because
    // these ops do NOT change game state: transient hints/heatmaps are merged
    // into each seat's view after the executor built it.
    if (op.type === 'hint' || op.type === 'heatmapToggle') {
      // RESEARCH Pitfall 3: reject concurrent bot searches while demo is running.
      if (this.demoRunning) {
        return {
          success: false,
          error: 'Cannot request hint while a demo is running — stop the demo first.',
          category: 'protocol',
        };
      }
      const res = await this.adapters.executeOp(this.snapshot, null, op);
      if (res.success) {
        if ('hintAnnotation' in res) {
          // Merge with existing seat entry so hint + heatmap coexist (RESEARCH Pitfall 6).
          const existing = this.transientTeachingState.get(res.hintAnnotation.seat) ?? {};
          this.transientTeachingState.set(res.hintAnnotation.seat, {
            ...existing,
            hint: { annotation: res.hintAnnotation.annotation },
          });
        }
        if ('heatmapUpdate' in res) {
          const existing = this.transientTeachingState.get(res.heatmapUpdate.seat) ?? {};
          this.transientTeachingState.set(res.heatmapUpdate.seat, {
            ...existing,
            heatmap: { visible: res.heatmapUpdate.visible, entries: res.heatmapUpdate.entries },
          });
        }
        this.broadcastCurrent();
      }
      return res;
    }

    // Read-only ops (resolveChoices + debug queries) report state without
    // mutating or broadcasting — just return the executor's result. They never
    // write the game snapshot, so they stay OFF the serialization chain.
    if (isReadOnlyOp(op)) {
      return this.adapters.executeOp(this.snapshot, this.pendingStates.get(seat) ?? null, op);
    }

    // Every state-MUTATING op sequence runs serialized on opChain. Its trailing
    // bot pump is part of the SAME critical section (runBotTurnsInner, not the
    // public runBotTurns), so a follow-up human op waits for the whole
    // human-move → bot-moves sequence to finish rather than reading the same base
    // snapshot mid-pump and last-write-wins clobbering it (dev-host-bot-op-race #1).
    return this.enqueue(() => this.applyMutatingOp(seat, op));
  }

  /**
   * The state-mutating tail of handleOp, always run inside the opChain critical
   * section (via enqueue). Executes the op, applies + broadcasts the result, and
   * drives any bot turns the move handed off to — all before the next enqueued
   * mutation can begin.
   */
  private async applyMutatingOp(seat: number, op: MutatingOp): Promise<OpResult> {
    // An op that closes the seat (the seat's own action, or the host closing a
    // seat at a deadline) runs without the seat's in-progress selection: it does not
    // continue those picks. They are dropped only once the close SUCCEEDS. A
    // refused close changed nothing, and it may be refused precisely because
    // the round it named is over (a stale submission), in which case the picks
    // belong to the new round and must survive.
    const closing = closesSeat(op);
    const res = await this.adapters.executeOp(this.snapshot, closing ? null : this.pendingStates.get(seat) ?? null, op);
    if (!res.success) return res;
    if (closing) this.pendingStates.delete(seat);
    // Only a selection step leaves the seat mid-action; every other op ends it.
    const pending = 'pendingState' in res ? res.pendingState : null;
    const actionCompleted = closing || ('actionComplete' in res && res.actionComplete === true);

    // Clear hint for the acting seat on successful action/selectionStep (completion):
    // a hint answers the position the seat was in, which its move just changed.
    if (actionCompleted) {
      const seatTransient = this.transientTeachingState.get(seat);
      if (seatTransient?.hint) {
        const { hint: _h, ...rest } = seatTransient;
        if (Object.keys(rest).length > 0) {
          this.transientTeachingState.set(seat, rest);
        } else {
          this.transientTeachingState.delete(seat);
        }
      }
    }

    // Clear ALL transient state on undo/rewind: it describes a position that is gone.
    if (op.type === 'undo' || op.type === 'debugRewind') {
      this.transientTeachingState.clear();
      this.narrationText = null;
      // Pending selections belong to that list: they hold element ids from the
      // replaced runner, exactly like the hint/heatmap above, so every seat's
      // goes. `apply` below only ever drops the ACTING seat's, so a simultaneous
      // step would leave another seat mid-chain against a game tree that no
      // longer exists. Clients are told the same fact by `restoreEpoch`.
      this.pendingStates.clear();
    }

    await this.apply(res, seat, pending);
    // A restore can land the game on a bot seat's turn, and nothing else will
    // ever wake it: the pump is driven by ops, and the only op that would
    // arrive is a human action the bot seat is not going to take. The table
    // just sits there. (Undo alone never showed this — it rewinds to the
    // requesting seat's own turn start, so the pump would find no due bot seat
    // anyway. A rewind can target ANY point, which is what made it reachable.)
    const restored = op.type === 'undo' || op.type === 'debugRewind';
    if (!this.isComplete && (actionCompleted || restored)) {
      // Already inside the critical section — drive the pump directly rather
      // than re-entering enqueue (which would deadlock on our own opChain link).
      await this.runBotTurnsInner();
    }
    // Keep any visible "Show move quality" heatmaps current as play proceeds:
    // recompute for the seat whose turn it now is, drop stale chips for the rest.
    // (The hint is already cleared on each action above; the heatmap must be
    // refreshed the same way or it freezes at the position where it was first
    // toggled on.)
    if (actionCompleted) {
      await this.refreshVisibleHeatmaps();
    }
    return res;
  }

  /**
   * Acknowledge that `seat` is now played by a bot, and WAKE THE PUMP.
   *
   * Always run inside the opChain critical section (via `handleOp`'s enqueue).
   *
   * ## Why this exists at all
   *
   * The pump reads the roster ({@link setBotSeats}) on every iteration, so a
   * roster that changed between moves is picked up on the next turn. What
   * {@link setBotSeats} does not do is DRIVE the pump: `runBotTurnsInner` runs
   * only off `applyMutatingOp` or the public `runBotTurns()`, so a conversion
   * with no following op would park the table on a seat no human is going to
   * play. This op is the wake.
   *
   * ## What it deliberately does NOT do
   *
   * It does not change the roster, and nothing about the conversion enters the
   * snapshot. The roster is whatever the platform last stated through
   * {@link setBotSeats}; a platform whose roster is derived (a caretaker bot
   * allowed to act only inside one turn window) states it again whenever what
   * it derives from changes, from `record` when that is a move, and the pump
   * reads the new answer before its next move.
   *
   * That is also why the roster, not this op, is the authority on whether the
   * seat IS a bot: a conversion the roster does not back is refused rather than
   * silently doing nothing.
   *
   * Idempotent: it writes no state, so re-converting an
   * already-converted seat is just another wake, and `botPumpRunning` plus the
   * opChain keep that from doubling any work.
   */
  private async applyConvertSeatToBot(seat: number): Promise<OpResultFor<'convertSeatToBot'>> {
    if (this.isComplete) {
      return {
        success: false,
        category: 'protocol',
        error:
          `Cannot convert seat ${seat} to bot: the game is already complete, so no seat owes a move. ` +
          `Nothing further is required — release the seat instead of converting it.`,
      };
    }
    if (!this.botSeats.some((s) => s.seat === seat)) {
      return {
        success: false,
        category: 'protocol',
        error:
          `Cannot convert seat ${seat} to bot: seat ${seat} is not reported as bot by the roster — ` +
          `convert the roster first (setBotSeats), then send this op. The roster is the ` +
          `authority on which seats a bot may play; this op only acknowledges the change and runs the bot.`,
      };
    }
    // `runBotTurnsInner`, not the public `runBotTurns()`: we are ALREADY inside
    // our own opChain link, and `runBotTurns()` enqueues onto that same chain, so
    // it would wait for a link that cannot settle until it returns — a deadlock.
    // `applyMutatingOp`'s trailing pump calls the inner one for the same reason.
    // The bot's moves are published and persisted as they are made, like any move.
    await this.runBotTurnsInner();
    return { success: true, convertedSeat: seat };
  }

  /**
   * ADOPT THIS GAME AS RE-DERIVED UNDER RULES THAT CHANGED BENEATH IT (#343).
   *
   * `boardsmith dev` swaps the rules its `executeOp` runs when an author saves,
   * and `carry` re-derives the current snapshot under them (see `RulesReload`).
   * It runs ON THE OP CHAIN, like every mutation: an op already in flight
   * finishes on the old rules first, and nothing reads the snapshot between
   * `carry` and the broadcast of what it produced.
   *
   * What goes with the old rules:
   * - transient teaching state (a hint or a heatmap was computed by them);
   * - on a REPLAY, every seat's half-finished selection too. It was made against
   *   a game tree the replay has just rebuilt, exactly as on an undo. A plain
   *   restore keeps them: the tree they point into is the one that was saved.
   *
   * - the positions a running demo could step back to: the old rules made them
   *   (#388).
   *
   * A `failed` carry leaves the game as it was, and the caller reports it. A
   * running demo stops, since the game cannot go on under these rules.
   */
  async adoptReloadedRules(carry: (snapshot: unknown) => Promise<RulesReload>): Promise<RulesReload> {
    return this.enqueue(async () => {
      const outcome = await carry(this._snapshot);
      if (outcome.kind === 'failed') {
        this.stopDemo();
        return outcome;
      }
      this.transientTeachingState.clear();
      this.narrationText = null;
      this.demoHistory = [];
      if (outcome.kind === 'replayed') this.pendingStates.clear();
      await this.apply(outcome.result);
      // The new rules may hand the turn to a bot seat, and no op will wake it.
      if (!this.isComplete) await this.runBotTurnsInner();
      return outcome;
    });
  }

  /**
   * Serialize a state-mutating unit of work on opChain: it runs only after every
   * previously-enqueued mutation settles, and blocks the next one until it
   * settles. A failure never poisons the chain — the continuation swallows it,
   * while the caller still receives fn's real result or rejection.
   */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(fn, fn);
    this.opChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Recompute every visible heatmap against the current snapshot. For the seat
   * whose turn it now is, re-run the heatmap op (which gates on canSeatAct and
   * returns fresh per-cell entries); for every other seat with a visible
   * heatmap, clear the now-stale entries while leaving the overlay toggled on.
   * Broadcasts once if anything changed.
   */
  private async refreshVisibleHeatmaps(): Promise<void> {
    let changed = false;
    for (const [seat, transient] of this.transientTeachingState) {
      if (!transient.heatmap?.visible) continue;
      // The heatmap op recomputes only when `seat` can act; otherwise it returns
      // a protocol error, which we treat as "not this seat's turn → clear".
      const res = await this.adapters.executeOp(this.snapshot, null, {
        type: 'heatmapToggle',
        seat,
        visible: true,
      });
      if (res.success && res.heatmapUpdate) {
        this.transientTeachingState.set(seat, {
          ...transient,
          heatmap: { visible: true, entries: res.heatmapUpdate.entries },
        });
        changed = true;
      } else if (transient.heatmap.entries.length > 0) {
        this.transientTeachingState.set(seat, {
          ...transient,
          heatmap: { visible: true, entries: [] },
        });
        changed = true;
      }
    }
    if (changed) this.broadcastCurrent();
  }

  /**
   * Public bot-pump entry. Serialized on opChain so an externally-triggered pump
   * (follow-mode toggle, seat release, game start — multiplayer-host.ts) can
   * never overlap an in-flight human op and clobber its snapshot. The trailing
   * pump inside applyMutatingOp calls runBotTurnsInner directly (already inside
   * the critical section) to avoid re-entering the chain.
   */
  async runBotTurns(): Promise<void> {
    await this.enqueue(() => this.runBotTurnsInner());
  }

  /** The bot seats the pump may ask now: every one not held back at this state (#421). */
  private botSeatsToAsk(): Array<{ seat: number; level?: string }> {
    const held = this.botSeatsHeldBack;
    const heldBack = held !== null && held.snapshot === this._snapshot ? held.seats : null;
    return this.botSeats.filter((s) => !heldBack?.has(s.seat));
  }

  /**
   * Report a refused bot turn, and hold the refused seat back until the game
   * state changes (#421). Returns whether the pump may go on to the other bot
   * seats: not when the op failed without naming a seat, because then there is
   * no seat to skip.
   *
   * A FAILED bot turn is not the same as "no bot turn was due". Breaking on
   * both without a word is how a bot seat silently stops driving the flow:
   * every seat waits on a bot that will never move again, with nothing in the
   * console on either side to say why. Fail loud — the bot produced a move the
   * engine rejected, which is a bug in the game's action definition, its bot
   * hooks, or move enumeration, and the developer needs to see it the moment
   * it happens.
   */
  private holdBackRefusedSeat(res: OpFailure, seats: Array<{ seat: number }>): boolean {
    const seat = res.botPlayer;
    const who = seat === undefined ? `seat(s) ${seats.map((s) => s.seat).join(', ')}` : `seat ${seat}`;
    const until = seat === undefined ? '' : ', and the bot will not try again until the game changes';
    console.error(
      `[SnapshotSessionHost] bot turn REJECTED for ${who}: ${res.error}` +
        `${res.errorCode ? ` (${res.errorCode})` : ''}. The bot cannot act, so the game will ` +
        `not advance past this step${until}. Check the action's selections and the bot's move ` +
        `enumeration for this seat.`,
    );
    if (seat === undefined) return false;
    this.holdBotSeatBack(seat);
    return true;
  }

  /**
   * Report a stalled bot seat, and hold it back until the game state changes
   * (#421).
   *
   * #29: `botMoved: false` covers both "no bot seat was due" (ordinary, the
   * pump is finished) and "a bot seat was due and could not act". The second
   * used to be an exception that never got this far — it escaped executeOp and
   * the seat silently never moved, holding open every simultaneous step at the
   * table. Say it out loud.
   */
  private holdBackStalledSeat(stalled: { seat: number; reason: string }): void {
    console.error(
      `[SnapshotSessionHost] bot seat ${stalled.seat} is STALLED: ${stalled.reason} ` +
        `The rest of the table can still act, but any step waiting on this seat will not close ` +
        `until a human takes it or the game changes.`,
    );
    this.holdBotSeatBack(stalled.seat);
  }

  /** Skip `seat` in the bot pump until the game state changes (#421). */
  private holdBotSeatBack(seat: number): void {
    const current = this.botSeatsHeldBack;
    const held = current !== null && current.snapshot === this._snapshot
      ? current
      : { snapshot: this._snapshot, seats: new Set<number>() };
    held.seats.add(seat);
    this.botSeatsHeldBack = held;
  }

  private async runBotTurnsInner(): Promise<void> {
    if (this.botPumpRunning || this.botSeats.length === 0) return;
    this.botPumpRunning = true;
    try {
      let moves = 0;
      while (true) {
        // A save landed while this chain ran (#388). The move under way when it
        // landed has finished; the rest wait for the reload. The chain gives up
        // its place on the op chain rather than waiting on it, because adopting
        // the edited rules is queued there behind it.
        if (this.hostWork.reloadPending) {
          this.hostWork.hold(() => this.runBotTurns());
          break;
        }
        if (moves >= MAX_BOT_MOVES) {
          console.error('[SnapshotSessionHost] bot pump hit MAX_BOT_MOVES cap (500); stopping to avoid runaway.');
          break;
        }
        const seats = this.botSeatsToAsk();
        if (seats.length === 0) break;
        const res = await this.adapters.executeOp(this.snapshot, null, { type: 'botTurn', seats });
        if (!res.success) {
          if (this.holdBackRefusedSeat(res, seats)) continue;
          break;
        }
        if (res.botStalled) {
          this.holdBackStalledSeat(res.botStalled);
          continue;
        }
        if (!res.botMoved) break;
        moves++;
        await this.apply(res);
        if (this.isComplete) break;
      }
    } finally {
      this.botPumpRunning = false;
    }
  }

  /**
   * Run the bot-vs-bot narrated demo loop.
   *
   * Each iteration: (1) preview the move via botSuggest (read-only MCTS),
   * (2) inject narration and broadcast BEFORE the move executes, (3) wait the
   * configured delay, (4) execute the EXACT same move via the 'action' op —
   * never re-running MCTS to avoid the narrate/execute mismatch anti-pattern.
   *
   * The loop is cancellable via `demoAbort`: checked at the top of each
   * iteration AND immediately after the delay (RESEARCH Pitfall 1). A `finally`
   * block guarantees cleanup on every exit path (stop, game-over, error, cap).
   *
   * Fire-and-forget: called via `void this.runDemoLoop(...)` from handleOp so
   * the demoStart response returns immediately while the loop runs asynchronously.
   */
  private async runDemoLoop(
    allSeats: Array<{ seat: number; level?: string }>,
  ): Promise<void> {
    this.demoRunning = true;
    this.demoAbort = false;
    this.broadcastCurrent(); // clients see isDemoRunning=true before first move

    let moves = 0;
    try {
      while (!this.demoAbort && !this.isComplete && moves < this.MAX_DEMO_MOVES) {
        // Capture the snapshot fresh EACH iteration so a 'back' rewind (which restores
        // this.snapshot) is reflected — the re-suggest then runs from the restored
        // position. The move is made only if the game still stands on this same
        // reference, so neither a concurrent op nor a rules reload can desync
        // narrate vs execute (WR-01, #388).
        const iterSnapshot = this.snapshot;

        // Phase 1: Preview the move (read-only — no state mutation).
        const suggestRes = await this.adapters.executeOp(iterSnapshot, null, {
          type: 'botSuggest',
          seats: allSeats,
        });
        if (!suggestRes.success) break;

        // Check abort AFTER the async botSuggest (Pitfall 1 — second check).
        if (this.demoAbort) break;

        const { botPlayer, suggestedAction, suggestedArgs } = suggestRes;

        // Phase 2: Narrate BEFORE executing (mirrors onBeforeMove semantics).
        // The announcement broadcast fires so clients see the move description
        // BEFORE the game state changes — this is the teaching signal. It stays
        // visible during the pace/pause below so the learner can read it.
        this.narrationText = this.buildNarration(botPlayer, suggestedAction, suggestedArgs as Record<string, unknown>);
        this.broadcastCurrent(); // announcement broadcast (isDemoRunning + narration)

        // Phase 3: Pace (speed delay), park (paused), or release-one (step). The
        // gate is cancellable: demoStop wakes it and its finally breaks; no timer
        // survives after stop (CLAUDE.md timer-leak rule).
        await this.demoPaceOrPause();
        if (this.demoAbort) break;

        // 'back' was pressed during the gate: the host already restored the pre-move
        // snapshot. Discard this now-stale suggestion and re-suggest from the restored
        // position on the next iteration (no execute, no move count change).
        if (this.demoRewound) {
          this.demoRewound = false;
          this.narrationText = null;
          this.broadcastCurrent();
          continue;
        }

        // Phases 4 and 5: make the narrated move, once the host lets it run.
        const made = await this.heldDemoMove(iterSnapshot, botPlayer, suggestedAction, suggestedArgs);
        if (made === 'stopped' || made === 'failed') break;
        if (made === 'stale') {
          // The position the move was chosen from is gone: the rules were
          // replaced under it (#388), or another op moved the game on. Choose
          // again from where the game stands.
          this.narrationText = null;
          this.broadcastCurrent();
          continue;
        }
        moves++;

        // A 'step' releases the gate for exactly one move — re-pause now that it
        // has executed (demoPaused stays true; the next gate parks).
        // (demoStepConsume was already cleared inside the gate.)

        // Early-exit check after apply: avoid a wasted botSuggest MCTS run when
        // the game just finished (RESEARCH Pitfall 2).
        if (this.isComplete) break;
      }
    } finally {
      // Always clean up — no leaked state regardless of how the loop exited
      // (stop, game-over, cap hit, error, or botSuggest failure).
      // This is the last line of defence for the CLAUDE.md timer-leak rule:
      // demoRunning=false is broadcast so every client sees isDemoRunning=false.
      this.demoRunning = false;
      this.demoAbort = false;
      this.demoPaused = false;
      this.demoStepConsume = false;
      this.demoRewound = false;
      this.demoHistory = [];
      this._demoWake = null;
      this.narrationText = null;
      this.broadcastCurrent(); // final broadcast: isDemoRunning=false
    }
  }

  /**
   * Make the demo's narrated move, handed to the host's work gate (#388) so a
   * move that comes due while an edited rules file rebuilds waits for the
   * reload, and on the op chain so nothing else moves the game while it runs.
   *
   * Answers `stale` when the game no longer stands where the move was chosen:
   * a move chosen by the rules from before a save is never made on the rules
   * after it.
   */
  private heldDemoMove(
    iterSnapshot: unknown,
    botPlayer: number,
    suggestedAction: string,
    suggestedArgs: Record<string, unknown>,
  ): Promise<'moved' | 'stale' | 'stopped' | 'failed'> {
    return new Promise((resolve, reject) => {
      this.hostWork.hold(() =>
        this.enqueue(() => this.makeDemoMove(iterSnapshot, botPlayer, suggestedAction, suggestedArgs)).then(
          resolve,
          reject,
        ),
      );
    });
  }

  private async makeDemoMove(
    iterSnapshot: unknown,
    botPlayer: number,
    suggestedAction: string,
    suggestedArgs: Record<string, unknown>,
  ): Promise<'moved' | 'stale' | 'stopped' | 'failed'> {
    if (this.demoAbort) return 'stopped';
    if (this._snapshot !== iterSnapshot) return 'stale';

    // Record the pre-move snapshot so 'back' can rewind exactly one move.
    this.demoHistory.push(this.snapshot);

    // Phase 4: Execute the EXACT same move via 'action' op.
    // ANTI-PATTERN AVOIDED: Do NOT re-run botSuggest/botTurn here — a second
    // MCTS call could produce a different move, making the narration a lie
    // (RESEARCH: "narrate/execute mismatch" anti-pattern).
    this.narrationText = null;
    const execRes = await this.adapters.executeOp(iterSnapshot, null, {
      type: 'action',
      actionName: suggestedAction,
      player: botPlayer,
      args: suggestedArgs,
      // A SERVER-COMPOSED op acting NOW: the demo bot chose this move from
      // `iterSnapshot`, which is still the game's position (checked above, on
      // the op chain), so the boundary it was composed against is that
      // snapshot's own. Stamping the current key is correct HERE and would be a
      // silent bypass anywhere a human's intent is being carried
      // (docs/simultaneous-and-interrupt-semantics.md §7).
      boundaryKey: flowBoundaryKey((iterSnapshot as { flowState?: BoundaryKeyState } | null)?.flowState),
    });

    if (!execRes.success) {
      this.demoHistory.pop(); // fail-clean: undo the history push
      return 'failed';
    }

    // Clear the acting seat's hint, as applyMutatingOp does for a human move.
    const seatTransient = this.transientTeachingState.get(botPlayer);
    if (seatTransient?.hint) {
      const { hint: _h, ...rest } = seatTransient;
      if (Object.keys(rest).length > 0) {
        this.transientTeachingState.set(botPlayer, rest);
      } else {
        this.transientTeachingState.delete(botPlayer);
      }
    }

    // Phase 5: Apply (broadcasts updated state; narration is already null).
    await this.apply(execRes);
    return 'moved';
  }

  /**
   * Pace-gate for the demo loop. Resolves when it is time to execute the narrated
   * move. Behaviour is re-evaluated on every control op (via wakeDemo):
   *  - abort / rewound  → release immediately (loop handles stop / re-suggest).
   *  - step             → release once (consume the one-shot), then re-pause.
   *  - paused           → park (no timer) until a later wake.
   *  - playing          → resolve after `demoDelay` ms (speed control).
   * Only ONE timer is ever live and it is always cleared before resolve, so no
   * timer survives a stop (CLAUDE.md timer-leak rule).
   */
  private demoPaceOrPause(): Promise<void> {
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const clearTimer = () => {
        if (timer !== null) { clearTimeout(timer); timer = null; }
      };
      const finish = () => {
        clearTimer();
        this._demoWake = null;
        resolve();
      };
      const evaluate = () => {
        clearTimer();
        if (this.demoAbort || this.demoRewound) { finish(); return; }
        if (this.demoStepConsume) { this.demoStepConsume = false; finish(); return; }
        if (this.demoPaused) return; // park — wait for the next wakeDemo()
        timer = setTimeout(finish, this.demoDelay);
      };
      // wakeDemo() invokes this until finish() nulls it.
      this._demoWake = evaluate;
      evaluate();
    });
  }

  /**
   * Rewind the demo by one move: restore the snapshot captured before the last
   * executed move and flag the loop to re-suggest from it. Pauses on rewind so the
   * learner can review. No-op when there is nothing to rewind.
   *
   * The restore goes through the `restoreEarlier` op, never by putting the old
   * snapshot and views back by hand: those carry the restore epoch clients have
   * already seen, so nothing would tell them the position went back, and the
   * next move's animations would reuse ids they already played and be dropped.
   */
  private async demoRewindOne(): Promise<void> {
    const prev = this.demoHistory.pop();
    if (prev === undefined) return;
    const res = await this.adapters.executeOp(this._snapshot, null, { type: 'restoreEarlier', snapshot: prev });
    if (!res.success) {
      this.demoHistory.push(prev);
      throw new Error(`The demo could not step back a move: ${res.error}`);
    }
    this.narrationText = null;
    this.demoPaused = true;
    this.demoStepConsume = false;
    this.demoRewound = true;
    // The game changed: published as a change, and persisted like any other.
    await this.apply(res);
  }

  /**
   * Format a narration string for one loop iteration.
   *
   * This string is broadcast to ALL seats — including opponents in hidden-
   * information games. Two strategies are used in priority order:
   *
   * 1. `adapters.narrateMove` hook (supplied by the game author): full control.
   *    Required for hidden-info games where the default would expose private data.
   *
   * 2. Safe default: only args whose keys appear in SAFE_DEST_ARGS
   *    (to, destination, target, square, cell, position) are included in the
   *    summary. All other args (e.g. card element IDs) are omitted to avoid
   *    leaking hidden information on LAN sessions. Open-information games
   *    (Checkers, Hex) are unaffected because their destination args use these
   *    standard key names.
   *
   * Uses "Player N" rather than the player's name: the host is not handed
   * player names.
   */
  private buildNarration(player: number, action: string, args: Record<string, unknown>): string {
    if (this.adapters.narrateMove) {
      return this.adapters.narrateMove(player, action, args);
    }
    // Safe default: format a readable destination ("c5 → a3 (capture)") from
    // destination-like args only — never raw element IDs (no hidden-info leak).
    return describeMoveForNarration(player, action, args);
  }
}
