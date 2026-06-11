import type { Op, OpResult } from './stateless-ops.js';
import { READ_ONLY_OP_TYPES } from './stateless-ops.js';

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

  constructor(private readonly adapters: SnapshotSessionAdapters) {}

  private async apply(res: OpResult, seat?: number): Promise<void> {
    this.snapshot = res.snapshot;
    this.flowState = res.flowState;
    this.isComplete = res.isComplete;
    this.winners = res.winners;
    if (seat !== undefined) {
      if (res.pendingState) this.pendingStates.set(seat, res.pendingState);
      else this.pendingStates.delete(seat);
    }
    this.adapters.broadcast(res.playerViews, { isComplete: res.isComplete, winners: res.winners });
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
