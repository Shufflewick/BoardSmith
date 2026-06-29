import type { Op, OpResult } from './stateless-ops.js';
import { READ_ONLY_OP_TYPES } from './stateless-ops.js';
import type { Annotation } from '../engine/index.js';
import type { HeatmapEntry } from './types.js';

export type { Op, OpResult } from './stateless-ops.js';

const MAX_AI_MOVES = 500;

export interface SnapshotSessionAdapters {
  playerCount: number;
  executeOp: (snapshot: unknown, pendingState: Record<string, unknown> | null, op: Op) => Promise<OpResult>;
  broadcast: (playerViews: unknown[], meta: { isComplete: boolean; winners: number[] }) => void;
  aiSeats?: Array<{ seat: number; level?: string }>;
  persist?: (state: { snapshot: unknown; pendingStates: Record<string, Record<string, unknown>> }) => void | Promise<void>;
}

export class SnapshotSessionHost {
  snapshot: unknown = null;
  flowState: unknown = null;
  isComplete = false;
  winners: number[] = [];
  private pendingStates = new Map<number, Record<string, unknown>>();
  private aiPumpRunning = false;

  // Transient teaching state — persists between ops, merged into every broadcast
  // post-buildPlayerState (mirrors GameSession.broadcast() injection pattern).
  transientTeachingState = new Map<number, {
    hint?: { annotation: Annotation };
    heatmap?: { visible: boolean; entries: HeatmapEntry[] };
  }>();
  demoRunning = false;
  narrationText: string | null = null;
  private lastPlayerViews: unknown[] = [];

  constructor(private readonly adapters: SnapshotSessionAdapters) {}

  /**
   * Merge transient teaching state into player views post-buildPlayerState.
   *
   * Short-circuits when there is no transient state AND no AI seats (identity
   * return — the common case for non-teaching games). This mirrors the
   * GameSession.broadcast() injection pattern (game-session.ts:1925-1934).
   *
   * Per-seat: hint, heatmap (keyed strictly by seat = i+1; no cross-seat leak).
   * Game-wide: narration, isDemoRunning, hasAIPlayers (applied to all seats).
   */
  private mergeTransientState(playerViews: unknown[]): unknown[] {
    const hasTransient = this.transientTeachingState.size > 0
      || this.demoRunning
      || this.narrationText !== null
      || (this.adapters.aiSeats?.length ?? 0) > 0;
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
      if (this.demoRunning) state.isDemoRunning = true;
      if (this.adapters.aiSeats?.length) state.hasAIPlayers = true;
      return { ...view, state };
    });
  }

  /**
   * Re-broadcast the last player views with the current transient teaching state
   * merged in. Used by future plans (hint/heatmap/demo ops) to re-broadcast
   * transient changes without re-running an op through executeOp.
   */
  broadcastCurrent(): void {
    const mergedViews = this.mergeTransientState(this.lastPlayerViews);
    this.adapters.broadcast(mergedViews, { isComplete: this.isComplete, winners: this.winners });
  }

  private async apply(res: OpResult, seat?: number): Promise<void> {
    this.snapshot = res.snapshot;
    this.flowState = res.flowState;
    this.isComplete = res.isComplete;
    this.winners = res.winners;
    if (seat !== undefined) {
      if (res.pendingState) this.pendingStates.set(seat, res.pendingState);
      else this.pendingStates.delete(seat);
    }
    this.lastPlayerViews = res.playerViews;
    const mergedViews = this.mergeTransientState(res.playerViews);
    this.adapters.broadcast(mergedViews, { isComplete: res.isComplete, winners: res.winners });
    await this.adapters.persist?.({ snapshot: this.snapshot, pendingStates: Object.fromEntries(this.pendingStates) });
  }

  async start(): Promise<void> {
    const res = await this.adapters.executeOp(null, null, { type: 'start' });
    if (!res.success) throw new Error(res.error ?? 'start op failed');
    await this.apply(res);
  }

  /** Read-only ops (resolveChoices) do NOT mutate or broadcast. State-mutating
   *  ops broadcast the new state, THEN the caller returns the op response. */
  async handleOp(seat: number, op: Op): Promise<OpResult> {
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
    // mutating or broadcasting — just return the executor's result.
    if (READ_ONLY_OP_TYPES.has(op.type)) {
      return this.adapters.executeOp(this.snapshot, this.pendingStates.get(seat) ?? null, op);
    }
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
    }

    await this.apply(res, seat);
    if (!this.isComplete && (op.type === 'action' || (op.type === 'selectionStep' && res.actionComplete))) {
      await this.runAITurns();
    }
    return res;
  }

  async runAITurns(): Promise<void> {
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
        if (!res.success || !res.aiMoved) break;
        moves++;
        await this.apply(res);
        if (this.isComplete) break;
      }
    } finally {
      this.aiPumpRunning = false;
    }
  }
}
