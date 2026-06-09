import type { Op, OpResult } from './stateless-ops.js';

export interface SnapshotSessionAdapters {
  playerCount: number;
  executeOp: (snapshot: unknown, pendingState: Record<string, unknown> | null, op: Op) => Promise<OpResult>;
  broadcast: (playerViews: unknown[], meta: { isComplete: boolean; winners: number[] }) => void;
  aiSeats?: Array<{ seat: number; level?: string }>;
  persist?: (state: { snapshot: unknown; pendingStates: Record<number, Record<string, unknown>> }) => void | Promise<void>;
}

export class SnapshotSessionHost {
  snapshot: unknown = null;
  flowState: unknown = null;
  isComplete = false;
  winners: number[] = [];
  private pendingStates = new Map<number, Record<string, unknown>>();
  private aiPumpRunning = false;

  constructor(private readonly a: SnapshotSessionAdapters) {}

  private apply(res: OpResult, seat?: number): void {
    this.snapshot = res.snapshot;
    this.flowState = res.flowState;
    this.isComplete = res.isComplete;
    this.winners = res.winners;
    if (seat !== undefined) {
      if (res.pendingState) this.pendingStates.set(seat, res.pendingState);
      else this.pendingStates.delete(seat);
    }
    this.a.broadcast(res.playerViews, { isComplete: res.isComplete, winners: res.winners });
    void this.a.persist?.({ snapshot: this.snapshot, pendingStates: Object.fromEntries(this.pendingStates) });
  }

  async start(): Promise<void> {
    const res = await this.a.executeOp(null, null, { type: 'start' });
    this.apply(res);
  }

  /** Read-only ops (resolveChoices) do NOT mutate or broadcast. State-mutating
   *  ops broadcast the new state, THEN the caller returns the op response. */
  async handleOp(seat: number, op: Op): Promise<OpResult> {
    if (op.type === 'resolveChoices') {
      return this.a.executeOp(this.snapshot, this.pendingStates.get(seat) ?? null, op);
    }
    const res = await this.a.executeOp(this.snapshot, this.pendingStates.get(seat) ?? null, op);
    if (!res.success) return res;
    this.apply(res, seat);
    if (!this.isComplete && (op.type === 'action' || (op.type === 'selectionStep' && res.actionComplete))) {
      await this.runAITurns();
    }
    return res;
  }

  async runAITurns(): Promise<void> {
    if (this.aiPumpRunning || !this.a.aiSeats?.length) return;
    this.aiPumpRunning = true;
    try {
      while (true) {
        const res = await this.a.executeOp(this.snapshot, null, { type: 'aiTurn', seats: this.a.aiSeats });
        if (!res.success || !res.aiMoved) break;
        this.apply(res);
        if (this.isComplete) break;
      }
    } finally {
      this.aiPumpRunning = false;
    }
  }
}
