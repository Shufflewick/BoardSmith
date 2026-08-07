import type { Op, OpResult } from './stateless-ops.js';
import { READ_ONLY_OP_TYPES } from './stateless-ops.js';
import type { Annotation } from '../engine/index.js';
import { describeMoveForNarration } from './move-summary.js';
import type { HeatmapEntry, SerializedFlowDebugInfo, SerializedPendingActionState } from './types.js';

export type { Op, OpResult } from './stateless-ops.js';

const MAX_AI_MOVES = 500;

/**
 * Consecutive persist() failures before `persistenceHealthy` flips false
 * (ERR-03). Mirrors GameSession's `PERSISTENCE_UNHEALTHY_THRESHOLD` so both
 * hosts escalate at the same count — this class duplicates the shape rather
 * than sharing a base class (this codebase has no shared host base class;
 * see serializeFlowDebugInfo-as-function for the same established pattern).
 */
const PERSISTENCE_UNHEALTHY_THRESHOLD = 3;

/** A single captured persistence failure. Never carries a stack trace or file paths (T-126-05). */
export interface PersistenceErrorEntry {
  message: string;
  timestamp: number;
}

export interface SnapshotSessionAdapters {
  playerCount: number;
  executeOp: (snapshot: unknown, pendingState: Record<string, unknown> | null, op: Op) => Promise<OpResult>;
  broadcast: (playerViews: unknown[], meta: { isComplete: boolean; winners: number[]; isDraw: boolean }) => void;
  aiSeats?: Array<{ seat: number; level?: string }>;
  /**
   * When true, demoStart is rejected fail-loud and state.teachingDisabled is broadcast
   * as true to every seat. Set once at session creation; never toggled mid-session.
   */
  teachingDisabled?: boolean;
  persist?: (state: { snapshot: unknown; pendingStates: Record<string, Record<string, unknown>> }) => void | Promise<void>;
  /**
   * Injectable hook invoked whenever `persist()` fails (ERR-03). Never
   * rethrown — a throwing hook is swallowed and echoed via `console.error`
   * so it can never crash gameplay (T-126-06). Symmetric with
   * `GameSessionOptions.onPersistenceError`.
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
   * @param args   - full action args from aiSuggest (may contain hidden data)
   * @returns      a narration string safe to broadcast to all seats
   */
  narrateMove?: (player: number, action: string, args: Record<string, unknown>) => string;
}

export class SnapshotSessionHost {
  snapshot: unknown = null;
  flowState: unknown = null;
  isComplete = false;
  winners: number[] = [];
  private pendingStates = new Map<number, Record<string, unknown>>();
  private aiPumpRunning = false;

  /**
   * Serialization chain for state-MUTATING op sequences (dev-host-ai-op-race #1
   * fix). A human action/selection (executeOp → apply → trailing AI pump) and
   * every externally-triggered runAITurns run to completion before the next
   * begins. Without this, a human op arriving during the AI pump's think-time
   * reads the same base snapshot and last-write-wins silently clobbers the
   * other's move — the intermittent dev-host lost-update wedge. Read-only and
   * teaching ops stay off the chain (they never write the game snapshot).
   */
  private opChain: Promise<unknown> = Promise.resolve();

  // Persistence health (ERR-03) — symmetric with GameSession's persistence surface.
  private lastPersistenceErrorEntry: PersistenceErrorEntry | null = null;
  private persistenceConsecutiveFailures = 0;

  // Transient teaching state — persists between ops, merged into every broadcast
  // post-buildPlayerState (mirrors GameSession.broadcast() injection pattern).
  transientTeachingState = new Map<number, {
    hint?: { annotation: Annotation };
    heatmap?: { visible: boolean; entries: HeatmapEntry[] };
  }>();
  demoRunning = false;
  narrationText: string | null = null;
  private lastPlayerViews: unknown[] = [];

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
    this.demoAbort = true;
    this.narrationText = null;
    // Wake the demo pace-gate synchronously so its timer is cleared and the
    // loop's finally runs without waiting — no timer survives disposal.
    this.wakeDemo();
  }

  // Flow-debug snapshot (FLOW-01/03): computed by the pure executor's
  // stateEnvelope() (shared serializeFlowDebugInfo — same wire shape as
  // GameSession.broadcast() and the debug:flow-state op) and carried forward
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
  private demoHistory: Array<{
    snapshot: unknown;
    flowState: unknown;
    isComplete: boolean;
    winners: number[];
    lastPlayerViews: unknown[];
  }> = [];
  private _demoWake: (() => void) | null = null;

  // Re-evaluate the pace-gate. Does NOT null _demoWake — the gate's own finish()
  // clears it when it actually resolves. (Nulling here would mean: after a 'pause'
  // re-parks the gate, the next 'play'/'step' wake finds null and no-ops, freezing
  // the demo — the gate could never be re-armed.)
  private wakeDemo(): void {
    this._demoWake?.();
  }

  constructor(private readonly adapters: SnapshotSessionAdapters) {}

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
   * (ERR-03 / T-126-03) — the counterpart to GameSession's #persistSafely.
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
   * Short-circuits when there is no transient state, no AI seats, no flow-debug
   * snapshot yet, and no pending action (identity return — the common case
   * before the very first executeOp/start). This mirrors the
   * GameSession.broadcast() injection pattern (game-session.ts:1925-1934).
   *
   * Per-seat: hint, heatmap, pendingAction (keyed strictly by seat = i+1; no
   * cross-seat leak — T-123-07). Game-wide: narration, isDemoRunning,
   * hasAIPlayers, flowDebugInfo (public flow structure, safe for every seat
   * and spectator — T-123-08).
   */
  private mergeTransientState(playerViews: unknown[]): unknown[] {
    // teachingDisabled must always be injected — include it in hasTransient so a
    // lockout-only session (no other transient state) still broadcasts the flag.
    // Per D-03 (criterion 4): every connected client reads the authoritative value
    // from broadcast, not local init alone.
    const hasTransient = this.transientTeachingState.size > 0
      || this.demoRunning
      || this.narrationText !== null
      || (this.adapters.aiSeats?.length ?? 0) > 0
      || (this.adapters.teachingDisabled ?? false)
      || this.lastFlowDebugInfo !== null
      || this.pendingStates.size > 0;
    if (!hasTransient) return playerViews;

    return (playerViews as Array<{ flowState: unknown; state: Record<string, unknown> } | null>).map((view, i) => {
      // Guard: stub/empty views (e.g. from AI pump tests) pass through unchanged.
      if (view == null || typeof view !== 'object' || !('state' in view)) return view;
      const seat = i + 1;
      const transient = this.transientTeachingState.get(seat);
      const state = { ...view.state };
      if (transient?.hint) state.hint = transient.hint;
      if (transient?.heatmap) state.heatmap = transient.heatmap;
      if (this.narrationText) state.narration = { text: this.narrationText };
      // Flow position is public game structure — shared across every seat.
      if (this.lastFlowDebugInfo) state.flowDebugInfo = this.lastFlowDebugInfo;
      // SECURITY (T-123-07): pendingAction MUST be looked up per-seat inside
      // this loop keyed on THIS seat only — never hoisted outside the loop or
      // shared across seats. A seat must never receive another seat's
      // accumulated pending-action args.
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
      if (this.adapters.aiSeats?.length) state.hasAIPlayers = true;
      // Always inject teachingDisabled (true or false) so every broadcast carries the
      // authoritative session value regardless of other transient state (criterion 4).
      state.teachingDisabled = this.adapters.teachingDisabled ?? false;
      return { ...view, state };
    });
  }

  /**
   * Re-broadcast the last player views with the current transient teaching state
   * merged in. Used by future plans (hint/heatmap/demo ops) to re-broadcast
   * transient changes without re-running an op through executeOp.
   */
  broadcastCurrent(): void {
    if (this.disposed) return; // F-12: a dead session never broadcasts.
    const mergedViews = this.mergeTransientState(this.lastPlayerViews);
    this.adapters.broadcast(mergedViews, {
      isComplete: this.isComplete,
      winners: this.winners,
      isDraw: this.isComplete && this.winners.length === 0,
    });
  }

  private async apply(res: OpResult, seat?: number): Promise<void> {
    this.snapshot = res.snapshot;
    this.flowState = res.flowState;
    this.isComplete = res.isComplete;
    this.winners = res.winners;
    // FLOW-01/03: every state-mutating op's stateEnvelope() carries a fresh
    // flowDebugInfo (shared serializeFlowDebugInfo — same shape as
    // GameSession.broadcast() and the debug:flow-state op). Carry it forward
    // so demo/control re-broadcasts (broadcastCurrent(), no fresh op result)
    // still show the last known flow position.
    if (res.flowDebugInfo) this.lastFlowDebugInfo = res.flowDebugInfo;
    if (seat !== undefined) {
      if (res.pendingState) this.pendingStates.set(seat, res.pendingState);
      else this.pendingStates.delete(seat);
    }
    this.lastPlayerViews = res.playerViews;
    if (this.disposed) return; // F-12: a dead session never broadcasts.
    const mergedViews = this.mergeTransientState(res.playerViews);
    this.adapters.broadcast(mergedViews, {
      isComplete: res.isComplete,
      winners: res.winners,
      isDraw: res.isComplete && res.winners.length === 0,
    });
    // Routed through persistSafely (ERR-03) — a persist() failure must never
    // throw out of apply() and must be observable via onPersistenceError /
    // lastPersistenceError / persistenceHealthy. No-op when no persist
    // adapter is configured (the dev host's default today).
    if (this.adapters.persist) {
      const persist = this.adapters.persist;
      await this.persistSafely(() => persist({ snapshot: this.snapshot, pendingStates: Object.fromEntries(this.pendingStates) }));
    }
  }

  async start(): Promise<void> {
    const res = await this.adapters.executeOp(null, null, { type: 'start' });
    if (!res.success) throw new Error(res.error ?? 'start op failed');
    await this.apply(res);
  }

  /** Read-only ops (resolveChoices) do NOT mutate or broadcast. State-mutating
   *  ops broadcast the new state, THEN the caller returns the op response. */
  async handleOp(seat: number, op: Op): Promise<OpResult> {
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
        // Build allSeats from all player seats. If aiSeats is configured, use
        // the first seat's level as the difficulty for all seats.
        const allSeats = Array.from({ length: this.adapters.playerCount }, (_, i) => ({
          seat: i + 1,
          level: this.adapters.aiSeats?.[0]?.level,
        }));
        // Reset playback controls for a fresh run.
        this.demoDelay = typeof op.delay === 'number' ? op.delay : 1200;
        this.demoPaused = false;
        this.demoStepConsume = false;
        this.demoRewound = false;
        this.demoHistory = [];
        void this.runDemoLoop(allSeats); // fire-and-forget
      }
      return {
        success: true,
        snapshot: this.snapshot,
        flowState: this.flowState,
        playerViews: [], // clients read demo state from game_state broadcasts (RESEARCH Pitfall 7)
        isComplete: this.isComplete,
        winners: this.winners,
        pendingState: null,
      };
    }
    if (op.type === 'demoStop') {
      this.demoAbort = true;
      // CR-01: clear narration immediately so any apply() broadcast during the
      // stop window does not inject stale narration text into all clients' views.
      this.narrationText = null;
      // CR-02: wake the pace-gate synchronously so its timer (if any) is cleared and
      // the loop continuation is scheduled as a microtask — the finally block then
      // runs (demoRunning=false + broadcastCurrent) without waiting for the timer.
      // Guarantees no timer survives after demoStop (CLAUDE.md timer-leak rule).
      this.wakeDemo();
      // Broadcast the clean state (narration cleared, still shows isDemoRunning=true
      // until the finally block fires in the next microtask drain).
      this.broadcastCurrent();
      return {
        success: true,
        snapshot: this.snapshot,
        flowState: this.flowState,
        playerViews: [],
        isComplete: this.isComplete,
        winners: this.winners,
        pendingState: null,
      };
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
            this.demoRewindOne();
            break;
        }
        // Wake the pace-gate so the control takes effect immediately (pause cancels a
        // pending delay; play/step release it; speed re-arms with the new delay).
        this.wakeDemo();
        this.broadcastCurrent();
      }
      return {
        success: true,
        snapshot: this.snapshot,
        flowState: this.flowState,
        playerViews: [],
        isComplete: this.isComplete,
        winners: this.winners,
        pendingState: null,
      };
    }

    // Teaching ops (hint / heatmapToggle): compute annotation, store in
    // transient state, re-broadcast via broadcastCurrent() — NOT apply() because
    // these ops do NOT change game state (mirrors the production GameSession
    // pattern: transient hints/heatmaps are injected post-buildPlayerState).
    if (op.type === 'hint' || op.type === 'heatmapToggle') {
      // RESEARCH Pitfall 3: reject concurrent bot searches while demo is running.
      if (this.demoRunning) {
        return {
          success: false,
          error: 'Cannot request hint while a demo is running — stop the demo first.',
          category: 'protocol',
          snapshot: this.snapshot,
          pendingState: null,
          flowState: this.flowState,
          playerViews: [],
          isComplete: this.isComplete,
          winners: this.winners,
        };
      }
      const res = await this.adapters.executeOp(this.snapshot, null, op);
      if (res.success) {
        if (res.hintAnnotation) {
          // Merge with existing seat entry so hint + heatmap coexist (RESEARCH Pitfall 6).
          const existing = this.transientTeachingState.get(res.hintAnnotation.seat) ?? {};
          this.transientTeachingState.set(res.hintAnnotation.seat, {
            ...existing,
            hint: { annotation: res.hintAnnotation.annotation },
          });
        }
        if (res.heatmapUpdate) {
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
    if (READ_ONLY_OP_TYPES.has(op.type)) {
      return this.adapters.executeOp(this.snapshot, this.pendingStates.get(seat) ?? null, op);
    }

    // Every state-MUTATING op sequence runs serialized on opChain. Its trailing
    // AI pump is part of the SAME critical section (runAITurnsInner, not the
    // public runAITurns), so a follow-up human op waits for the whole
    // human-move → AI-moves sequence to finish rather than reading the same base
    // snapshot mid-pump and last-write-wins clobbering it (dev-host-ai-op-race #1).
    return this.enqueue(() => this.applyMutatingOp(seat, op));
  }

  /**
   * The state-mutating tail of handleOp, always run inside the opChain critical
   * section (via enqueue). Executes the op, applies + broadcasts the result, and
   * drives any AI turns the move handed off to — all before the next enqueued
   * mutation can begin.
   */
  private async applyMutatingOp(seat: number, op: Op): Promise<OpResult> {
    // A new direct action supersedes any in-progress selection for this seat.
    // Clear pending state BEFORE executing so a failed superseding action
    // doesn't leave stale selection state behind (matches the old DO's
    // applyHumanAction, which deleted pending state before a direct action).
    if (op.type === 'action') this.pendingStates.delete(seat);
    const res = await this.adapters.executeOp(this.snapshot, this.pendingStates.get(seat) ?? null, op);
    if (!res.success) return res;

    // Clear hint for the acting seat on successful action/selectionStep (completion).
    // Mirrors GameSession.performAction: this.#hint.delete(player).
    if (op.type === 'action' || (op.type === 'selectionStep' && res.actionComplete)) {
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

    // Clear ALL transient state on undo/rewind (mirrors game-session.ts:312-313).
    if (op.type === 'undo' || op.type === 'debugRewind') {
      this.transientTeachingState.clear();
      this.narrationText = null;
      // Pending selections belong to that list: they hold element ids from the
      // replaced runner, exactly like the hint/heatmap above. GameSession does
      // this for EVERY seat (`PendingActionManager.updateRunner` clears the whole
      // map); `apply` below only ever drops the ACTING seat's, so a simultaneous
      // step would leave another seat mid-chain against a game tree that no
      // longer exists. Clients are told the same fact by `restoreEpoch`.
      this.pendingStates.clear();
    }

    await this.apply(res, seat);
    const actionCompleted = op.type === 'action' || (op.type === 'selectionStep' && res.actionComplete);
    if (!this.isComplete && actionCompleted) {
      // Already inside the critical section — drive the pump directly rather
      // than re-entering enqueue (which would deadlock on our own opChain link).
      await this.runAITurnsInner();
    }
    // Keep any visible "Show move quality" heatmaps current as play proceeds:
    // recompute for the seat whose turn it now is, drop stale chips for the rest.
    // Mirrors GameSession.#refreshVisibleHeatmaps (the hint is already cleared on
    // each action above; the heatmap must be refreshed the same way or it freezes
    // at the position where it was first toggled on).
    if (actionCompleted) {
      await this.refreshVisibleHeatmaps();
    }
    return res;
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
   * Public AI-pump entry. Serialized on opChain so an externally-triggered pump
   * (follow-mode toggle, seat release, game start — multiplayer-host.ts) can
   * never overlap an in-flight human op and clobber its snapshot. The trailing
   * pump inside applyMutatingOp calls runAITurnsInner directly (already inside
   * the critical section) to avoid re-entering the chain.
   */
  async runAITurns(): Promise<void> {
    await this.enqueue(() => this.runAITurnsInner());
  }

  private async runAITurnsInner(): Promise<void> {
    if (this.aiPumpRunning || !this.adapters.aiSeats?.length) return;
    this.aiPumpRunning = true;
    try {
      let moves = 0;
      while (true) {
        if (moves >= MAX_AI_MOVES) {
          console.error('[SnapshotSessionHost] AI pump hit MAX_AI_MOVES cap (500); stopping to avoid runaway.');
          break;
        }
        const res = await this.adapters.executeOp(this.snapshot, null, { type: 'aiTurn', seats: this.adapters.aiSeats });
        // A FAILED AI turn is not the same as "no AI turn was due". Breaking on
        // both without a word is how an AI seat silently stops driving the flow:
        // every seat waits on a bot that will never move again, with nothing in
        // the console on either side to say why. Fail loud — the bot produced a
        // move the engine rejected, which is a bug in the game's action
        // definition, its AI hooks, or move enumeration, and the developer needs
        // to see it the moment it happens.
        if (!res.success) {
          console.error(
            `[SnapshotSessionHost] AI turn REJECTED for seat(s) ` +
              `${this.adapters.aiSeats.map((s) => s.seat).join(', ')}: ${res.error ?? 'unknown error'}` +
              `${res.errorCode ? ` (${res.errorCode})` : ''}. The AI cannot act, so the game will ` +
              `not advance past this step. Check the action's selections and the bot's move ` +
              `enumeration for this seat.`,
          );
          break;
        }
        if (!res.aiMoved) break;
        moves++;
        await this.apply(res);
        if (this.isComplete) break;
      }
    } finally {
      this.aiPumpRunning = false;
    }
  }

  /**
   * Run the AI-vs-AI narrated demo loop.
   *
   * Each iteration: (1) preview the move via aiSuggest (read-only MCTS),
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
        // position. aiSuggest and the execute op below use this same reference so a
        // concurrent human handleOp cannot desync narrate vs execute (WR-01).
        const iterSnapshot = this.snapshot;

        // Phase 1: Preview the move (read-only — no state mutation).
        const suggestRes = await this.adapters.executeOp(iterSnapshot, null, {
          type: 'aiSuggest',
          seats: allSeats,
        });
        if (!suggestRes.success || !suggestRes.suggestedAction) break;

        // Check abort AFTER the async aiSuggest (Pitfall 1 — second check).
        if (this.demoAbort) break;

        const { aiPlayer, suggestedAction, suggestedArgs = {} } = suggestRes;
        if (!aiPlayer) break;

        // Phase 2: Narrate BEFORE executing (mirrors onBeforeMove semantics).
        // The announcement broadcast fires so clients see the move description
        // BEFORE the game state changes — this is the teaching signal. It stays
        // visible during the pace/pause below so the learner can read it.
        this.narrationText = this.buildNarration(aiPlayer, suggestedAction, suggestedArgs as Record<string, unknown>);
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

        // Record the pre-move state so 'back' can rewind exactly one move.
        this.demoHistory.push({
          snapshot: this.snapshot,
          flowState: this.flowState,
          isComplete: this.isComplete,
          winners: this.winners,
          lastPlayerViews: this.lastPlayerViews,
        });

        // Phase 4: Execute the EXACT same move via 'action' op.
        // ANTI-PATTERN AVOIDED: Do NOT re-run aiSuggest/aiTurn here — a second
        // MCTS call could produce a different move, making the narration a lie
        // (RESEARCH: "narrate/execute mismatch" anti-pattern).
        // WR-01: use iterSnapshot (captured at iteration start) to match the
        // snapshot that aiSuggest used — prevents state desync under concurrent ops.
        this.narrationText = null;
        const execRes = await this.adapters.executeOp(iterSnapshot, null, {
          type: 'action',
          actionName: suggestedAction,
          player: aiPlayer,
          args: suggestedArgs as Record<string, unknown>,
        });

        if (!execRes.success) { this.demoHistory.pop(); break; } // fail-clean: undo the history push

        // Clear the acting seat's hint (mirrors performAction hint.delete(player)).
        const seatTransient = this.transientTeachingState.get(aiPlayer);
        if (seatTransient?.hint) {
          const { hint: _h, ...rest } = seatTransient;
          if (Object.keys(rest).length > 0) {
            this.transientTeachingState.set(aiPlayer, rest);
          } else {
            this.transientTeachingState.delete(aiPlayer);
          }
        }

        // Phase 5: Apply (broadcasts updated state; narration is already null).
        await this.apply(execRes);
        moves++;

        // A 'step' releases the gate for exactly one move — re-pause now that it
        // has executed (demoPaused stays true; the next gate parks).
        // (demoStepConsume was already cleared inside the gate.)

        // Early-exit check after apply: avoid a wasted aiSuggest MCTS run when
        // the game just finished (RESEARCH Pitfall 2).
        if (this.isComplete) break;
      }
    } finally {
      // Always clean up — no leaked state regardless of how the loop exited
      // (stop, game-over, cap hit, error, or aiSuggest failure).
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
   */
  private demoRewindOne(): void {
    const prev = this.demoHistory.pop();
    if (!prev) return;
    this.snapshot = prev.snapshot;
    this.flowState = prev.flowState;
    this.isComplete = prev.isComplete;
    this.winners = prev.winners;
    this.lastPlayerViews = prev.lastPlayerViews;
    this.narrationText = null;
    this.demoPaused = true;
    this.demoStepConsume = false;
    this.demoRewound = true;
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
   * Mirrors the default narrator in game-session.ts:1142-1149 but uses
   * "Player N" instead of the player name (no player-name threading in
   * the stateless path — RESEARCH open-Q2 RESOLVED).
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
