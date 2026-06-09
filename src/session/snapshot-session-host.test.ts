import { describe, it, expect, vi } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike, type Op, type OpResult } from './stateless-ops.js';
import { SnapshotSessionHost, type SnapshotSessionAdapters } from './snapshot-session-host.js';

// ---------------------------------------------------------------------------
// Inline game: player 1 repeatedly takes a "pass" action in a loop.
// ---------------------------------------------------------------------------

class SimpleGame extends Game<SimpleGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('pass').execute(() => ({ success: true })),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          do: actionStep({
            actions: ['pass'],
            player: (ctx) => ctx.game.getPlayer(1)!,
          }),
        }),
      }),
    );
  }
}

const simpleGameDef: GameDefinitionLike = {
  gameClass: SimpleGame as new (...args: unknown[]) => unknown,
  gameType: 'simple',
  minPlayers: 1,
  maxPlayers: 4,
};

const gameOptions = { playerCount: 2, seed: 'host-test' };

// ---------------------------------------------------------------------------
// Inline game: two-step selection action (for pendingState threading test).
// ---------------------------------------------------------------------------

class TwoStepGame extends Game<TwoStepGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('pick')
        .chooseFrom<string>('color', { choices: ['red', 'blue', 'green'] })
        .chooseFrom<string>('size', { choices: ['S', 'M', 'L'] })
        .execute(() => ({ success: true })),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          do: actionStep({
            actions: ['pick'],
            player: (ctx) => ctx.game.getPlayer(1)!,
          }),
        }),
      }),
    );
  }
}

const twoStepGameDef: GameDefinitionLike = {
  gameClass: TwoStepGame as new (...args: unknown[]) => unknown,
  gameType: 'twostep',
  minPlayers: 1,
  maxPlayers: 2,
};

const twoStepGameOptions = { playerCount: 2, seed: 'step-seed' };

// ---------------------------------------------------------------------------
// Helper: build adapters bound to a real game definition
// ---------------------------------------------------------------------------

function makeAdapters(
  def: GameDefinitionLike,
  opts: { playerCount: number; seed?: string },
  extra: Partial<SnapshotSessionAdapters> = {},
): { adapters: SnapshotSessionAdapters; broadcastLog: unknown[][] } {
  const broadcastLog: unknown[][] = [];
  const adapters: SnapshotSessionAdapters = {
    playerCount: opts.playerCount,
    executeOp: (snap, pend, op) => executeOp(def, opts, snap, pend, op),
    broadcast: (views, meta) => broadcastLog.push([views, meta]),
    ...extra,
  };
  return { adapters, broadcastLog };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SnapshotSessionHost', () => {

  // ── 1. Broadcast-before-response ordering ──────────────────────────────────

  describe('broadcast-before-response ordering', () => {
    it('broadcasts the new state BEFORE the handleOp promise resolves for a state-mutating op', async () => {
      const { adapters } = makeAdapters(simpleGameDef, gameOptions);
      const eventLog: string[] = [];

      // Override broadcast to push an event
      adapters.broadcast = (views, meta) => {
        eventLog.push('broadcast');
      };

      const host = new SnapshotSessionHost(adapters);
      await host.start();

      const snapshotBefore = host.snapshot;
      eventLog.length = 0; // reset after start

      const resultPromise = host.handleOp(1, { type: 'action', actionName: 'pass', player: 1, args: {} });
      // Push 'response' AFTER the promise resolves
      const result = await resultPromise;
      eventLog.push('response');

      // The last broadcast must appear before 'response'
      const broadcastIdx = eventLog.lastIndexOf('broadcast');
      const responseIdx = eventLog.indexOf('response');
      expect(broadcastIdx).toBeGreaterThanOrEqual(0);
      expect(broadcastIdx).toBeLessThan(responseIdx);

      // And the snapshot must have changed
      expect(JSON.stringify(host.snapshot)).not.toBe(JSON.stringify(snapshotBefore));
      expect(result.success).toBe(true);
    });
  });

  // ── 2. resolveChoices is read-only ─────────────────────────────────────────

  describe('resolveChoices is read-only', () => {
    it('does NOT broadcast and does NOT change host.snapshot', async () => {
      const { adapters, broadcastLog } = makeAdapters(twoStepGameDef, twoStepGameOptions);
      const host = new SnapshotSessionHost(adapters);
      await host.start();

      broadcastLog.length = 0;
      const snapshotBefore = host.snapshot;

      const result = await host.handleOp(1, {
        type: 'resolveChoices',
        actionName: 'pick',
        player: 1,
        selectionName: 'color',
        args: {},
      });

      expect(result.success).toBe(true);
      // No broadcast
      expect(broadcastLog).toHaveLength(0);
      // Snapshot unchanged
      expect(JSON.stringify(host.snapshot)).toBe(JSON.stringify(snapshotBefore));
      // Returned choices
      expect(Array.isArray(result.choices)).toBe(true);
      expect((result.choices as unknown[]).length).toBeGreaterThan(0);
    });
  });

  // ── 3. pendingState threading ──────────────────────────────────────────────

  describe('pendingState threading', () => {
    it('threads pendingState across two selectionStep calls and completes the action', async () => {
      const { adapters, broadcastLog } = makeAdapters(twoStepGameDef, twoStepGameOptions);
      const host = new SnapshotSessionHost(adapters);
      await host.start();

      const snapshotAfterStart = host.snapshot;
      broadcastLog.length = 0;

      // Step 1: choose color
      const step1 = await host.handleOp(1, {
        type: 'selectionStep',
        player: 1,
        selectionName: 'color',
        value: 'red',
        actionName: 'pick',
      });

      expect(step1.success).toBe(true);
      expect(step1.actionComplete).toBe(false);
      // step1 has pending state; the host should have stored it for seat 1
      expect(step1.pendingState).not.toBeNull();

      const snapshotAfterStep1 = host.snapshot;

      // Step 2: choose size — the host threads the stored pendingState automatically
      const step2 = await host.handleOp(1, {
        type: 'selectionStep',
        player: 1,
        selectionName: 'size',
        value: 'M',
        actionName: 'pick',
        initialArgs: { color: 'red' },
      });

      expect(step2.success).toBe(true);
      expect(step2.actionComplete).toBe(true);
      expect(step2.pendingState).toBeNull();

      // Snapshot should have advanced from step1→step2 (action completed)
      expect(JSON.stringify(host.snapshot)).not.toBe(JSON.stringify(snapshotAfterStep1));

      // Broadcasts fire for every state-mutating op via apply, regardless of actionComplete
      expect(broadcastLog.length).toBe(2);
    });

    it('threads step-1 pendingState into the step-2 executeOp call (same seat)', async () => {
      // Use a multi-player variant where BOTH players share the same step flow.
      // We'll just verify seat 1 and seat 2 can each carry independent pendingState.
      // We need a game where both seats can act; reuse twoStepGameDef but inject
      // a custom executeOp that tracks pendingState passed per seat.

      const calls: Array<{ pendingState: Record<string, unknown> | null }> = [];
      const realExecOp = (snap: unknown, pend: Record<string, unknown> | null, op: Op) =>
        executeOp(twoStepGameDef, twoStepGameOptions, snap, pend, op);

      const { adapters } = makeAdapters(twoStepGameDef, twoStepGameOptions);
      adapters.executeOp = (snap, pend, op) => {
        calls.push({ pendingState: pend });
        return realExecOp(snap, pend, op);
      };

      const host = new SnapshotSessionHost(adapters);
      await host.start();

      // Seat 1 step 1
      await host.handleOp(1, {
        type: 'selectionStep',
        player: 1,
        selectionName: 'color',
        value: 'red',
        actionName: 'pick',
      });

      // Seat 1 step 2 — the host should pass seat 1's pendingState automatically
      const callsBeforeStep2 = calls.length;
      await host.handleOp(1, {
        type: 'selectionStep',
        player: 1,
        selectionName: 'size',
        value: 'M',
        actionName: 'pick',
        initialArgs: { color: 'red' },
      });

      // The executeOp call for step2 must have received a non-null pendingState
      const step2Call = calls[callsBeforeStep2];
      expect(step2Call).toBeDefined();
      expect(step2Call.pendingState).not.toBeNull();
    });
  });

  // ── 4. AI pump ─────────────────────────────────────────────────────────────

  describe('AI pump', () => {
    it('runAITurns loops while aiMoved:true then stops, applying each move', async () => {
      // Use a stub executeOp that answers start normally, then returns aiMoved:true
      // once and aiMoved:false on the next call.
      const baseSnapshot = { stubbed: true };
      const baseResult: OpResult = {
        success: true,
        snapshot: baseSnapshot,
        pendingState: null,
        flowState: { awaitingInput: true, currentPlayer: 1 },
        playerViews: [null, null],
        isComplete: false,
        winners: [],
        aiMoved: false,
      };

      let aiCallCount = 0;
      const broadcastLog: unknown[][] = [];

      const adapters: SnapshotSessionAdapters = {
        playerCount: 2,
        executeOp: async (_snap, _pend, op) => {
          if (op.type === 'start') {
            return { ...baseResult, snapshot: { turn: 0 } };
          }
          if (op.type === 'aiTurn') {
            aiCallCount++;
            if (aiCallCount === 1) {
              return { ...baseResult, snapshot: { turn: 1 }, aiMoved: true, aiPlayer: 2 };
            }
            return { ...baseResult, snapshot: { turn: 1 }, aiMoved: false };
          }
          return { ...baseResult };
        },
        broadcast: (views, meta) => broadcastLog.push([views, meta]),
        aiSeats: [{ seat: 2 }],
      };

      const host = new SnapshotSessionHost(adapters);
      await host.start();

      broadcastLog.length = 0;
      await host.runAITurns();

      // Loop should have called executeOp(aiTurn) twice: once getting aiMoved:true
      // (applies move, broadcasts) and once getting aiMoved:false (stops).
      expect(aiCallCount).toBe(2);

      // One broadcast from the applied AI move
      expect(broadcastLog).toHaveLength(1);

      // Snapshot updated to the moved state
      expect((host.snapshot as { turn: number }).turn).toBe(1);
    });

    it('runAITurns is re-entrant-safe (aiPumpRunning guard prevents double execution)', async () => {
      let aiCallCount = 0;
      let resolveFirstAiCall!: (v: OpResult) => void;
      const firstAiCallPromise = new Promise<OpResult>((res) => {
        resolveFirstAiCall = res;
      });

      const baseResult: OpResult = {
        success: true,
        snapshot: {},
        pendingState: null,
        flowState: {},
        playerViews: [],
        isComplete: false,
        winners: [],
      };

      const adapters: SnapshotSessionAdapters = {
        playerCount: 2,
        executeOp: async (_snap, _pend, op) => {
          if (op.type === 'start') return { ...baseResult };
          if (op.type === 'aiTurn') {
            aiCallCount++;
            if (aiCallCount === 1) return firstAiCallPromise;
            return { ...baseResult, aiMoved: false };
          }
          return { ...baseResult };
        },
        broadcast: () => {},
        aiSeats: [{ seat: 1 }],
      };

      const host = new SnapshotSessionHost(adapters);
      await host.start();

      // Start first pump (will stall on the first aiTurn call)
      const pump1 = host.runAITurns();
      // Immediately fire a second pump — should be a no-op due to aiPumpRunning guard
      const pump2 = host.runAITurns();

      // Resolve the first AI call so both pumps can finish
      resolveFirstAiCall({ ...baseResult, aiMoved: false });

      await Promise.all([pump1, pump2]);

      // Should only have been called once (first pump ran, second was a no-op)
      expect(aiCallCount).toBe(1);
    });

    it('triggers runAITurns automatically after a successful human action', async () => {
      const { adapters, broadcastLog } = makeAdapters(simpleGameDef, gameOptions);

      // Track ai pump calls
      let aiCallCount = 0;
      const realExecOp = adapters.executeOp;
      adapters.executeOp = async (snap, pend, op) => {
        if (op.type === 'aiTurn') {
          aiCallCount++;
          return { ...(await realExecOp(snap, pend, op)), aiMoved: false };
        }
        return realExecOp(snap, pend, op);
      };
      adapters.aiSeats = [{ seat: 2 }];

      const host = new SnapshotSessionHost(adapters);
      await host.start();
      broadcastLog.length = 0;

      await host.handleOp(1, { type: 'action', actionName: 'pass', player: 1, args: {} });

      // AI pump should have been triggered (at least one aiTurn call)
      expect(aiCallCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── persist hook ───────────────────────────────────────────────────────────

  describe('persist hook', () => {
    it('calls persist after each state-mutating op with snapshot and pendingStates', async () => {
      const persisted: unknown[] = [];
      const { adapters } = makeAdapters(simpleGameDef, gameOptions);
      adapters.persist = (state) => { persisted.push(state); };

      const host = new SnapshotSessionHost(adapters);
      await host.start();

      persisted.length = 0; // reset after start
      await host.handleOp(1, { type: 'action', actionName: 'pass', player: 1, args: {} });

      expect(persisted).toHaveLength(1);
      const saved = persisted[0] as { snapshot: unknown; pendingStates: Record<number, unknown> };
      expect(saved.snapshot).toBeTruthy();
      expect(typeof saved.pendingStates).toBe('object');
    });
  });
});
