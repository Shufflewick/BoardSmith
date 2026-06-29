import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../engine/index.js';
import type { Annotation } from '../engine/index.js';
import type { AIConfig } from '../ai/types.js';
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
        .chooseFrom('color', { choices: ['red', 'blue', 'green'] })
        .chooseFrom('size', { choices: ['S', 'M', 'L'] })
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
// Inline game: two players alternating with 2+ legal moves each turn.
// Reusable fixture for Plans 02/03 (hint/heatmap/demo ops); also used to prove
// that aiTurn picks from multiple choices.
//
// MEMORY note: MCTS short-circuits when only 1 move is available — the bot
// skips the clone step. Tests that need real MCTS branching require 2+ choices.
// BotGame uses chooseFrom('direction', ['left', 'right']) to provide 2 legal moves.
// ---------------------------------------------------------------------------

class BotGame extends Game<BotGame, Player> {
  moveCount = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('move')
        .chooseFrom('direction', { choices: ['left', 'right'] })
        .execute(() => {
          this.moveCount++;
          return { success: true };
        }),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 100,
          do: actionStep({
            actions: ['move'],
            player: (ctx) => ctx.game.getPlayer(1)!,
          }),
        }),
      }),
    );
  }
}

// Extended def type — supports ai config (Plans 02/03 will add ai? to GameDefinitionLike;
// for now this test-local interface allows the fixture to carry the ai config).
interface BotGameDefinitionLike extends GameDefinitionLike {
  ai?: AIConfig;
}

const botGameAI: AIConfig = {
  objectives: (_game, _playerIndex) => ({
    moves: {
      checker: (game) => Math.min(1, (game as BotGame).moveCount / 20),
      weight: 1,
    },
  }),
  // Extract 'direction' arg as notation so heatmap entries have extractable cell refs.
  // Without this, DEST_ARGS fallback wouldn't find 'direction' and entries would be empty.
  hintTargetFromMove: (move) => {
    const dir = (move.args as { direction?: string }).direction;
    return dir ? { notation: dir } : undefined;
  },
};

export const botGameDef: BotGameDefinitionLike = {
  gameClass: BotGame as new (...args: unknown[]) => unknown,
  gameType: 'bot-game',
  minPlayers: 1,
  maxPlayers: 2,
  ai: botGameAI,
};

export const botGameOptions = { playerCount: 2, seed: 'bot-seed' };

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

    it('caps the AI pump at MAX_AI_MOVES (500) and logs when a runaway bundle never stops', async () => {
      const base: OpResult = {
        success: true,
        snapshot: {},
        pendingState: null,
        flowState: {},
        playerViews: [],
        isComplete: false,
        winners: [],
        aiMoved: true,
      };

      let aiCallCount = 0;
      const adapters: SnapshotSessionAdapters = {
        playerCount: 2,
        // A buggy bundle that ALWAYS reports a move was made — would loop forever
        // without the cap.
        executeOp: async (_snap, _pend, op) => {
          if (op.type === 'start') return { ...base, aiMoved: false };
          if (op.type === 'aiTurn') {
            aiCallCount++;
            return { ...base, aiMoved: true };
          }
          return { ...base };
        },
        broadcast: () => {},
        aiSeats: [{ seat: 2 }],
      };

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const host = new SnapshotSessionHost(adapters);
      await host.start();

      // Must terminate (not hang) and stop exactly at the cap.
      await host.runAITurns();

      expect(aiCallCount).toBe(500);
      expect(errSpy).toHaveBeenCalledWith(
        '[SnapshotSessionHost] AI pump hit MAX_AI_MOVES cap (500); stopping to avoid runaway.',
      );

      errSpy.mockRestore();
    });
  });

  // ── 5. New action supersedes an in-progress selection ───────────────────────

  describe('action supersedes in-progress selection', () => {
    it('clears stale pending state when a new (failing) action is dispatched mid-selection', async () => {
      const calls: Array<{ type: string; pendingState: Record<string, unknown> | null }> = [];
      const base: OpResult = {
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
        executeOp: async (_snap, pend, op) => {
          calls.push({ type: op.type, pendingState: pend });
          if (op.type === 'start') return { ...base };
          if (op.type === 'selectionStep') {
            // Mid-action: action not complete, so the host retains pendingState.
            return { ...base, actionComplete: false, pendingState: { step: 'mid' } };
          }
          if (op.type === 'action') {
            // The superseding action FAILS — must not leave stale pending behind.
            return { ...base, success: false, error: 'boom' };
          }
          return { ...base };
        },
        broadcast: () => {},
      };

      const host = new SnapshotSessionHost(adapters);
      await host.start();

      const startCalls = calls.length;

      // Step A: drive seat 1 into a mid-action pending state.
      await host.handleOp(1, {
        type: 'selectionStep',
        player: 1,
        selectionName: 'color',
        value: 'red',
        actionName: 'pick',
      });

      // Step B: a follow-up selectionStep proves the pending state was retained.
      await host.handleOp(1, {
        type: 'selectionStep',
        player: 1,
        selectionName: 'size',
        value: 'M',
        actionName: 'pick',
      });
      const followUpCall = calls[startCalls + 1];
      expect(followUpCall.type).toBe('selectionStep');
      expect(followUpCall.pendingState).not.toBeNull();

      // Step C: a NEW action is dispatched mid-selection and FAILS.
      const actionRes = await host.handleOp(1, {
        type: 'action',
        actionName: 'pass',
        player: 1,
        args: {},
      });
      expect(actionRes.success).toBe(false);
      // The action itself must have run with pending already cleared.
      const actionCall = calls[startCalls + 2];
      expect(actionCall.type).toBe('action');
      expect(actionCall.pendingState).toBeNull();

      // Step D: a subsequent selectionStep for that seat now sees NO stale pending.
      await host.handleOp(1, {
        type: 'selectionStep',
        player: 1,
        selectionName: 'color',
        value: 'blue',
        actionName: 'pick',
      });
      const afterActionCall = calls[startCalls + 3];
      expect(afterActionCall.type).toBe('selectionStep');
      expect(afterActionCall.pendingState).toBeNull();
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

  // ── 6. Transient teaching state foundation (Plan 110-01) ───────────────────
  //
  // These tests verify the mergeTransientState / broadcastCurrent / hasAIPlayers
  // primitives added in Plan 110-01, Task 1. No hint/heatmap/demo ops are tested
  // here — that is Plans 02/03.

  describe('transient teaching state foundation', () => {

    // ── Test (1): hasAIPlayers in every broadcast when aiSeats present ────────

    it('injects state.hasAIPlayers === true into every broadcast view when aiSeats is set', async () => {
      const { adapters, broadcastLog } = makeAdapters(simpleGameDef, gameOptions, {
        aiSeats: [{ seat: 2 }],
      });
      const host = new SnapshotSessionHost(adapters);
      await host.start();
      broadcastLog.length = 0;

      await host.handleOp(1, { type: 'action', actionName: 'pass', player: 1, args: {} });

      // At least one broadcast must have fired (from apply())
      expect(broadcastLog.length).toBeGreaterThanOrEqual(1);

      // The broadcast from the action (first entry after reset) must carry hasAIPlayers
      const [views] = broadcastLog[0] as [Array<{ flowState: unknown; state: Record<string, unknown> }>, unknown];
      for (const view of views) {
        expect(view.state.hasAIPlayers).toBe(true);
      }
    });

    // ── Test (2): identity short-circuit when no aiSeats and no transient state

    it('returns views unchanged (no hasAIPlayers) when aiSeats is absent and no transient state', async () => {
      // No aiSeats in adapters
      const { adapters, broadcastLog } = makeAdapters(simpleGameDef, gameOptions);
      const host = new SnapshotSessionHost(adapters);
      await host.start();
      broadcastLog.length = 0;

      await host.handleOp(1, { type: 'action', actionName: 'pass', player: 1, args: {} });

      expect(broadcastLog.length).toBeGreaterThanOrEqual(1);

      const [views] = broadcastLog[0] as [Array<{ flowState: unknown; state: Record<string, unknown> }>, unknown];
      for (const view of views) {
        expect(view.state.hasAIPlayers).toBeUndefined();
      }
    });

    // ── Test (3): per-seat hint isolation (RESEARCH Pitfall 6) ───────────────

    it('applies hint only to seat 1, not seat 2 (per-seat isolation)', async () => {
      const { adapters, broadcastLog } = makeAdapters(simpleGameDef, gameOptions);
      const host = new SnapshotSessionHost(adapters);
      await host.start();
      broadcastLog.length = 0;

      // Directly seed seat 1's transient state with a fake hint annotation
      const fakeAnnotation: Annotation = { text: 'Go here!' };
      host.transientTeachingState.set(1, { hint: { annotation: fakeAnnotation } });

      // broadcastCurrent re-broadcasts lastPlayerViews with merge applied
      host.broadcastCurrent();

      expect(broadcastLog).toHaveLength(1);
      const [views] = broadcastLog[0] as [Array<{ flowState: unknown; state: Record<string, unknown> }>, unknown];

      // Seat 1 (index 0) must have the hint
      const seat1State = views[0].state as { hint?: { annotation: Annotation } };
      expect(seat1State.hint?.annotation.text).toBe('Go here!');

      // Seat 2 (index 1) must NOT have the hint
      const seat2State = views[1].state as { hint?: unknown };
      expect(seat2State.hint).toBeUndefined();
    });

    // ── Test (4): game-wide narration + isDemoRunning on ALL seats ────────────

    it('applies narration and isDemoRunning to all seats (game-wide signals)', async () => {
      const { adapters, broadcastLog } = makeAdapters(simpleGameDef, gameOptions);
      const host = new SnapshotSessionHost(adapters);
      await host.start();
      broadcastLog.length = 0;

      // Directly seed game-wide signals
      host.narrationText = 'Player 1: pass';
      host.demoRunning = true;

      host.broadcastCurrent();

      expect(broadcastLog).toHaveLength(1);
      const [views] = broadcastLog[0] as [Array<{ flowState: unknown; state: Record<string, unknown> }>, unknown];

      for (const view of views) {
        const s = view.state as { narration?: { text: string }; isDemoRunning?: boolean };
        expect(s.narration?.text).toBe('Player 1: pass');
        expect(s.isDemoRunning).toBe(true);
      }
    });

  });

  // ── 7. hint + heatmapToggle ops via handleOp (Plan 110-02) ────────────────
  //
  // These tests verify that hint/heatmapToggle ops store results in
  // transientTeachingState and re-broadcast via broadcastCurrent; that hint
  // clears on the acting seat's next action; and that undo clears all transient
  // state. Uses the BotGame fixture exported from this file.

  describe('hint + heatmapToggle handleOp integration', () => {

    // Helper to get the view for a given seat from the last broadcast
    type SeatState = {
      hint?: { annotation: { text: string; target?: unknown } };
      heatmap?: { visible: boolean; entries: unknown[] };
    };

    function lastBroadcastState(broadcastLog: unknown[][], seat: number): SeatState {
      const last = broadcastLog[broadcastLog.length - 1];
      if (!last) throw new Error('no broadcast');
      const [views] = last as [Array<{ state: SeatState }>, unknown];
      return views[seat - 1].state;
    }

    // ── Test (1): hint op → broadcast carries state.hint for requesting seat ─

    it('hint op stores hintAnnotation and re-broadcasts with state.hint on the seat', async () => {
      const { adapters, broadcastLog } = makeAdapters(botGameDef, botGameOptions, {
        aiSeats: [{ seat: 2 }],
      });
      const host = new SnapshotSessionHost(adapters);
      await host.start();
      broadcastLog.length = 0;

      const res = await host.handleOp(1, { type: 'hint', seat: 1 });

      expect(res.success).toBe(true);
      // broadcastCurrent should have fired once
      expect(broadcastLog.length).toBe(1);
      const s1 = lastBroadcastState(broadcastLog, 1);
      expect(s1.hint).toBeDefined();
      expect(s1.hint!.annotation.text).toBe('Suggested move');
      // Seat 2 must NOT have seat 1's hint (per-seat isolation)
      const s2 = lastBroadcastState(broadcastLog, 2);
      expect(s2.hint).toBeUndefined();
    });

    // ── Test (2a): heatmap-toggle visible=true → state.heatmap.visible===true ─

    it('heatmapToggle visible=true broadcasts heatmap.visible===true with entries', async () => {
      const { adapters, broadcastLog } = makeAdapters(botGameDef, botGameOptions, {
        aiSeats: [{ seat: 2 }],
      });
      const host = new SnapshotSessionHost(adapters);
      await host.start();
      broadcastLog.length = 0;

      const res = await host.handleOp(1, { type: 'heatmapToggle', seat: 1, visible: true });

      expect(res.success).toBe(true);
      expect(broadcastLog.length).toBe(1);
      const s1 = lastBroadcastState(broadcastLog, 1);
      expect(s1.heatmap?.visible).toBe(true);
      expect(Array.isArray(s1.heatmap?.entries)).toBe(true);
      expect((s1.heatmap?.entries ?? []).length).toBeGreaterThan(0);
    });

    // ── Test (2b): heatmap-toggle visible=false → state.heatmap.visible===false ─

    it('heatmapToggle visible=false broadcasts heatmap.visible===false with empty entries', async () => {
      const { adapters, broadcastLog } = makeAdapters(botGameDef, botGameOptions, {
        aiSeats: [{ seat: 2 }],
      });
      const host = new SnapshotSessionHost(adapters);
      await host.start();
      broadcastLog.length = 0;

      const res = await host.handleOp(1, { type: 'heatmapToggle', seat: 1, visible: false });

      expect(res.success).toBe(true);
      expect(broadcastLog.length).toBe(1);
      const s1 = lastBroadcastState(broadcastLog, 1);
      expect(s1.heatmap?.visible).toBe(false);
      expect(s1.heatmap?.entries).toHaveLength(0);
    });

    // ── Test (3): hint clears on seat's next successful action ───────────────

    it('clears seat hint from transient state after a successful action by that seat', async () => {
      const { adapters, broadcastLog } = makeAdapters(botGameDef, botGameOptions, {
        aiSeats: [{ seat: 2 }],
      });
      const host = new SnapshotSessionHost(adapters);
      await host.start();

      // Request a hint for seat 1
      await host.handleOp(1, { type: 'hint', seat: 1 });
      broadcastLog.length = 0;

      // Seat 1 performs an action
      await host.handleOp(1, { type: 'action', actionName: 'move', player: 1, args: { direction: 'left' } });

      // The broadcast after the action must NOT carry state.hint for seat 1
      const s1 = lastBroadcastState(broadcastLog, 1);
      expect(s1.hint).toBeUndefined();
    });

    // ── Test (4): undo clears all transient state ─────────────────────────────

    it('clears all transient state (hint + heatmap) on undo', async () => {
      const { adapters, broadcastLog } = makeAdapters(botGameDef, botGameOptions, {
        aiSeats: [{ seat: 2 }],
      });
      const host = new SnapshotSessionHost(adapters);
      await host.start();

      // First perform an action so undo has something to undo
      await host.handleOp(1, { type: 'action', actionName: 'move', player: 1, args: { direction: 'left' } });

      // Request a hint for seat 1 (seeded into transient state)
      await host.handleOp(1, { type: 'hint', seat: 1 });
      expect(host.transientTeachingState.size).toBeGreaterThan(0);

      broadcastLog.length = 0;

      // Undo — must clear all transient state
      await host.handleOp(1, { type: 'undo', player: 1 });

      expect(host.transientTeachingState.size).toBe(0);
      // The broadcast after undo must NOT carry any hint
      const s1 = lastBroadcastState(broadcastLog, 1);
      expect(s1.hint).toBeUndefined();
    });

    // ── Test (5): hint + heatmap coexist on the same seat ────────────────────

    it('per-seat hint and heatmap coexist — storing heatmap does not overwrite hint', async () => {
      const { adapters, broadcastLog } = makeAdapters(botGameDef, botGameOptions, {
        aiSeats: [{ seat: 2 }],
      });
      const host = new SnapshotSessionHost(adapters);
      await host.start();
      broadcastLog.length = 0;

      // Request hint then heatmap for seat 1
      await host.handleOp(1, { type: 'hint', seat: 1 });
      await host.handleOp(1, { type: 'heatmapToggle', seat: 1, visible: true });

      // Final broadcast must carry BOTH hint and heatmap for seat 1
      const s1 = lastBroadcastState(broadcastLog, 1);
      expect(s1.hint).toBeDefined();
      expect(s1.heatmap?.visible).toBe(true);
    });

    // ── Test (6): hint rejected while demoRunning guard ──────────────────────

    it('rejects hint with an actionable error while demoRunning is true', async () => {
      const { adapters } = makeAdapters(botGameDef, botGameOptions, {
        aiSeats: [{ seat: 2 }],
      });
      const host = new SnapshotSessionHost(adapters);
      await host.start();

      // Directly set demoRunning to simulate a running demo
      host.demoRunning = true;

      const res = await host.handleOp(1, { type: 'hint', seat: 1 });

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/demo is running/i);

      // Restore
      host.demoRunning = false;
    });

  });

  // ── 8. Demo loop (Plan 110-03) ────────────────────────────────────────────
  //
  // Tests for the AI-vs-AI narrated demo loop in runDemoLoop + handleOp
  // demoStart/demoStop. Uses fake timers to control the delay between
  // narration and execution.
  //
  // CLAUDE.md hard rule: no timer may remain pending after demo-stop OR
  // after game-over. Verified with vi.getTimerCount() === 0.
  //
  // DESIGN NOTE: These tests stub the aiSuggest op (returning a deterministic
  // canned move) to avoid MCTS's internal setImmediate scheduling from
  // conflicting with vi.useFakeTimers(). The real 'action' op still runs
  // through executeOp to advance genuine game state. This approach tests
  // the demo LOOP'S control flow (narrate-before-execute, cancellation, timer
  // cleanup) in isolation from MCTS timing.

  describe('demo loop (demoStart / demoStop / runDemoLoop)', () => {

    afterEach(() => vi.useRealTimers());

    // ── makeDemoAdapters: stub aiSuggest, real action execution ───────────────
    //
    // Stubs aiSuggest to return a deterministic canned move without MCTS.
    // maxSuggestions: after this many aiSuggest calls, return failure to
    // simulate a game reaching its end (no more actable seat).

    function makeDemoAdapters(
      opts: { playerCount: number; seed?: string },
      extra: { maxSuggestions?: number } = {},
    ): { adapters: SnapshotSessionAdapters; broadcastLog: unknown[][] } {
      const broadcastLog: unknown[][] = [];
      let suggestCount = 0;

      const adapters: SnapshotSessionAdapters = {
        playerCount: opts.playerCount,
        executeOp: async (snap, pend, op) => {
          if (op.type === 'aiSuggest') {
            suggestCount++;
            if (extra.maxSuggestions !== undefined && suggestCount > extra.maxSuggestions) {
              // Simulate no more moves (game-over equivalent)
              return {
                success: false,
                error: 'No actable seat (simulated game-over)',
                category: 'protocol' as const,
                snapshot: snap,
                pendingState: null,
                flowState: {},
                playerViews: [],
                isComplete: false,
                winners: [],
              };
            }
            // Return a deterministic canned move (direction='left')
            return {
              success: true,
              snapshot: snap,
              flowState: {},
              playerViews: [],
              isComplete: false,
              winners: [],
              pendingState: null,
              aiPlayer: 1,
              suggestedAction: 'move',
              suggestedArgs: { direction: 'left' } as Record<string, unknown>,
            };
          }
          // All other ops (including 'action') use the real executeOp for
          // genuine game state advancement
          return executeOp(botGameDef, opts, snap, pend, op);
        },
        broadcast: (views, meta) => broadcastLog.push([views, meta]),
        aiSeats: [{ seat: 1 }],
      };
      return { adapters, broadcastLog };
    }

    // Helper: get broadcast state for a seat at a given index
    type DemoState = {
      isDemoRunning?: boolean;
      narration?: { text: string };
    };

    function broadcastState(broadcastLog: unknown[][], idx: number, seat: number): DemoState {
      const entry = broadcastLog[idx];
      if (!entry) throw new Error(`No broadcast at index ${idx}`);
      const [views] = entry as [Array<{ state: DemoState }>, unknown];
      return views[seat - 1].state;
    }

    // ── Test 1: narration broadcast BEFORE move executes ─────────────────────

    it('broadcasts narration BEFORE the move state change (narrated args === executed args)', async () => {
      vi.useFakeTimers();

      const { adapters, broadcastLog } = makeDemoAdapters(botGameOptions);
      const host = new SnapshotSessionHost(adapters);
      await host.start();
      broadcastLog.length = 0;

      // demoStart returns immediately (fire-and-forget loop)
      await host.handleOp(1, { type: 'demoStart', delay: 0 });

      // Advance all timers (processes the delay:0 setTimeout in the loop)
      await vi.runAllTimersAsync();

      // With stubs and delay:0, the loop runs until aiSuggest keeps succeeding
      // (no maxSuggestions limit) until MAX_DEMO_MOVES. Use demo-stop to stop.
      // Actually the loop runs many iterations. Let's stop it now.
      await host.handleOp(1, { type: 'demoStop' });
      await vi.runAllTimersAsync();

      // Broadcast sequence for the first iteration:
      // [0] isDemoRunning=true (initial broadcastCurrent before first move)
      // [1] narration broadcast (announce before execute — isDemoRunning + narration)
      // [2] state after move (apply())
      expect(broadcastLog.length).toBeGreaterThanOrEqual(3);

      // Broadcast 0: isDemoRunning=true, NO narration yet
      const b0 = broadcastState(broadcastLog, 0, 1);
      expect(b0.isDemoRunning).toBe(true);
      expect(b0.narration).toBeUndefined();

      // Broadcast 1: isDemoRunning=true, narration present (BEFORE move executes)
      const b1 = broadcastState(broadcastLog, 1, 1);
      expect(b1.isDemoRunning).toBe(true);
      expect(b1.narration?.text).toBeDefined();
      // Stub canned move is 'move direction=left' → narration should reflect that
      expect(b1.narration!.text).toBe('Player 1: move direction=left');

      // Broadcast 2: state after move (apply broadcast); narration cleared
      const b2 = broadcastState(broadcastLog, 2, 1);
      expect(b2.narration).toBeUndefined();

      // Final broadcast: isDemoRunning=false (cleanup)
      const bLast = broadcastState(broadcastLog, broadcastLog.length - 1, 1);
      expect(bLast.isDemoRunning).toBeUndefined();

      // CLAUDE.md: no pending timers
      expect(vi.getTimerCount()).toBe(0);
    });

    // ── Test 2: self-terminates when aiSuggest fails (game-over simulation) ──

    it('self-terminates when no more moves available (game-over), final broadcast isDemoRunning=false, timer count 0', async () => {
      vi.useFakeTimers();

      // maxSuggestions:2 → loop runs 2 full moves then aiSuggest returns failure
      const { adapters, broadcastLog } = makeDemoAdapters(botGameOptions, { maxSuggestions: 2 });
      const host = new SnapshotSessionHost(adapters);
      await host.start();
      broadcastLog.length = 0;

      await host.handleOp(1, { type: 'demoStart', delay: 0 });

      // Run all timers: 2 x setTimeout(0) for the 2 move delays, then loop exits on 3rd aiSuggest failure
      await vi.runAllTimersAsync();

      // Loop should have self-terminated: demoRunning=false
      expect(host.demoRunning).toBe(false);

      // Final broadcast must show isDemoRunning cleared (undefined = not set = false)
      const bLast = broadcastState(broadcastLog, broadcastLog.length - 1, 1);
      expect(bLast.isDemoRunning).toBeUndefined();

      // CLAUDE.md hard rule: no pending timer after game-over / aiSuggest failure
      expect(vi.getTimerCount()).toBe(0);
    });

    // ── Test 3: CANCELLATION — demo-stop before delay fires ──────────────────
    //
    // Start demo with a 5-second delay. The loop calls aiSuggest (sync stub),
    // broadcasts narration, then awaits setTimeout(5000). Call demoStop BEFORE
    // the 5s fires (setting demoAbort). Then advance timers: the 5s fires,
    // the loop sees demoAbort and breaks WITHOUT executing the move.
    // No additional broadcasts after the cleanup broadcast; timer count = 0.

    it('CANCELLATION: demo-stop halts loop before delay fires, no extra move executes, timer count 0', async () => {
      vi.useFakeTimers();

      const { adapters, broadcastLog } = makeDemoAdapters(botGameOptions);
      const host = new SnapshotSessionHost(adapters);
      await host.start();
      broadcastLog.length = 0;

      // Start demo with a 5-second delay
      void host.handleOp(1, { type: 'demoStart', delay: 5000 });

      // Flush microtasks so the loop runs through aiSuggest + narration broadcast
      // and reaches the await setTimeout(5000) pause point.
      // (stub aiSuggest is async → needs microtask flushes, not timer advancement)
      for (let i = 0; i < 20; i++) await Promise.resolve();

      // At this point: broadcastLog has [0]=isDemoRunning + [1]=narration
      // The loop is now waiting at the 5000ms setTimeout (not yet fired)

      // Call demo-stop: sets demoAbort=true
      await host.handleOp(1, { type: 'demoStop' });

      // Record broadcast count BEFORE advancing timers
      const broadcastCountAfterStop = broadcastLog.length;

      // Advance all fake timers: the 5s setTimeout fires
      // After firing, the loop checks demoAbort → true → breaks
      // Finally block fires: cleanup broadcast (isDemoRunning=false)
      await vi.runAllTimersAsync();

      // After advance: exactly one more broadcast (the cleanup), OR zero
      // if the loop already exited before the timer (demoAbort check after aiSuggest)
      const newBroadcasts = broadcastLog.length - broadcastCountAfterStop;
      expect(newBroadcasts).toBeLessThanOrEqual(1);

      // Demo loop is stopped
      expect(host.demoRunning).toBe(false);

      // CLAUDE.md hard rule: no pending timer after demo-stop
      expect(vi.getTimerCount()).toBe(0);
    });

    // ── Test 4: second demoStart is a no-op while running ────────────────────

    it('a second demoStart while the demo is running is a no-op (demoRunning guard)', async () => {
      vi.useFakeTimers();

      const { adapters, broadcastLog } = makeDemoAdapters(botGameOptions);
      const host = new SnapshotSessionHost(adapters);
      await host.start();
      broadcastLog.length = 0;

      // Start demo with delay:5000 (stuck at first timer)
      void host.handleOp(1, { type: 'demoStart', delay: 5000 });

      // Let the loop get past aiSuggest and reach the setTimeout
      for (let i = 0; i < 20; i++) await Promise.resolve();

      const broadcastsAfterFirstStart = broadcastLog.length;

      // Second demoStart — should be a no-op because demoRunning===true
      await host.handleOp(1, { type: 'demoStart', delay: 5000 });

      // No additional broadcasts from the second demoStart
      expect(broadcastLog.length).toBe(broadcastsAfterFirstStart);

      // Clean up
      await host.handleOp(1, { type: 'demoStop' });
      await vi.runAllTimersAsync();

      // CLAUDE.md: no pending timers
      expect(vi.getTimerCount()).toBe(0);
    });

    // ── Test 5: buildNarration produces "Player N: action key=val" format ─────

    it('narration text follows "Player N: action key=val" format', async () => {
      vi.useFakeTimers();

      const { adapters, broadcastLog } = makeDemoAdapters(botGameOptions, { maxSuggestions: 1 });
      const host = new SnapshotSessionHost(adapters);
      await host.start();
      broadcastLog.length = 0;

      await host.handleOp(1, { type: 'demoStart', delay: 0 });
      await vi.runAllTimersAsync();

      // Find the narration broadcast (has narration.text)
      const narrationBroadcast = broadcastLog.find((entry) => {
        const [views] = entry as [Array<{ state: { narration?: { text: string } } }>, unknown];
        return views[0]?.state?.narration?.text != null;
      });

      expect(narrationBroadcast).toBeDefined();
      const [views] = narrationBroadcast as [Array<{ state: { narration?: { text: string } } }>, unknown];
      const text = views[0].state.narration!.text;
      // Canned move: 'move' with direction='left'
      // Expected: "Player 1: move direction=left"
      expect(text).toBe('Player 1: move direction=left');
    });

  });
});
