import { describe, it, expect, vi } from 'vitest';
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
});
