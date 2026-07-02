import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike, type OpResult } from '../../session/index.js';
import { createDevSession, translateOp, shapeResult } from './bridge.js';
import { getEntries, clearEntries } from './log-capture.js';

// ---------------------------------------------------------------------------
// Inline game: seat 1 repeatedly takes a "pass" action in a loop.
// ---------------------------------------------------------------------------

class SimpleGame extends Game<SimpleGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          do: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! }),
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

const gameOptions = { playerCount: 2, seed: 'bridge-test' };

interface Posted {
  kind: 'game_state' | 'server_response';
  seat: number;
}

function makeSession() {
  const posted: Posted[] = [];
  const session = createDevSession({
    playerCount: 2,
    executeOp: (snap, pend, op) =>
      executeOp(simpleGameDef, op.type === 'start' ? gameOptions : { playerCount: 2 }, snap, pend, op),
    postGameState: (seat) => posted.push({ kind: 'game_state', seat }),
    postServerResponse: (seat) => posted.push({ kind: 'server_response', seat }),
  });
  return { session, posted };
}

describe('dev host bridge', () => {
  describe('translateOp', () => {
    it('maps wire ops (snake_case) to the host Op union with the acting seat', () => {
      expect(translateOp('action', 3, { actionName: 'pass', args: { x: 1 } })).toEqual({
        type: 'action',
        actionName: 'pass',
        player: 3,
        args: { x: 1 },
      });
      expect(translateOp('resolve_choices', 2, { actionName: 'pick', selectionName: 'color' })).toEqual({
        type: 'resolveChoices',
        actionName: 'pick',
        player: 2,
        selectionName: 'color',
        args: {},
      });
      expect(translateOp('selection_step', 1, { selectionName: 'color', value: 'red', actionName: 'pick' })).toMatchObject({
        type: 'selectionStep',
        player: 1,
        selectionName: 'color',
        value: 'red',
        actionName: 'pick',
      });
      expect(translateOp('cancel_action', 4, {})).toEqual({ type: 'cancelAction', player: 4 });
      expect(translateOp('undo', 4, {})).toEqual({ type: 'undo', player: 4 });
      // Teaching wire ops
      expect(translateOp('hint', 2, { seat: 2 })).toEqual({ type: 'hint', seat: 2 });
      expect(translateOp('heatmap-toggle', 1, { seat: 1, visible: true })).toEqual({
        type: 'heatmapToggle', seat: 1, visible: true,
      });
      expect(translateOp('heatmap-toggle', 1, { seat: 1, visible: false })).toEqual({
        type: 'heatmapToggle', seat: 1, visible: false,
      });
      // Demo lifecycle wire ops
      expect(translateOp('demo-start', 1, { delay: 0 })).toEqual({ type: 'demoStart', delay: 0 });
      expect(translateOp('demo-start', 1, {})).toEqual({ type: 'demoStart', delay: undefined });
      expect(translateOp('demo-stop', 1, {})).toEqual({ type: 'demoStop' });
      expect(translateOp('bogus', 1, {})).toBeUndefined();
    });
  });

  describe('shapeResult', () => {
    it('returns only {success,error,followUp} for an action', () => {
      const r = shapeResult('action', {
        success: true,
        followUp: { action: 'next' },
        snapshot: {},
        pendingState: null,
        flowState: {},
        playerViews: [],
        isComplete: false,
        winners: [],
        choices: ['leaked'],
      });
      expect(r).toEqual({ success: true, error: undefined, followUp: { action: 'next' } });
    });

    it('returns the full result for resolve_choices', () => {
      const r = shapeResult('resolve_choices', {
        success: true,
        choices: ['red', 'blue'],
        snapshot: {},
        pendingState: null,
        flowState: {},
        playerViews: [],
        isComplete: false,
        winners: [],
      });
      expect(r.choices).toEqual(['red', 'blue']);
    });

    // ── warnings threading (ERR-01 T-126-09) ────────────────────────────────
    //
    // shapeResult is a manual allowlist (RESEARCH Pitfall 4) — warnings added
    // to OpResult are invisible on the wire unless explicitly forwarded.

    it("forwards result.warnings on the 'action' case", () => {
      const r = shapeResult('action', {
        success: true,
        followUp: undefined,
        snapshot: {},
        pendingState: null,
        flowState: {},
        playerViews: [],
        isComplete: false,
        winners: [],
        warnings: [{ code: 'BOARD_REFS_ERROR', message: 'boardRefs boom', source: 'boardRefs(...)' }],
      });
      expect((r as Record<string, unknown>).warnings).toEqual([
        { code: 'BOARD_REFS_ERROR', message: 'boardRefs boom', source: 'boardRefs(...)' },
      ]);
    });

    it("forwards result.warnings on the 'selection_step' case", () => {
      const r = shapeResult('selection_step', {
        success: true,
        done: true,
        actionComplete: true,
        snapshot: {},
        pendingState: null,
        flowState: {},
        playerViews: [],
        isComplete: false,
        winners: [],
        warnings: [{ code: 'DISPLAY_ERROR', message: 'display boom', source: 'display(...)' }],
      });
      expect((r as Record<string, unknown>).warnings).toEqual([
        { code: 'DISPLAY_ERROR', message: 'display boom', source: 'display(...)' },
      ]);
    });

    it("resolve_choices full-passthrough still carries warnings (regression guard)", () => {
      const r = shapeResult('resolve_choices', {
        success: true,
        choices: ['red', 'blue'],
        snapshot: {},
        pendingState: null,
        flowState: {},
        playerViews: [],
        isComplete: false,
        winners: [],
        warnings: [{ code: 'BOARD_REFS_ERROR', message: 'boardRefs boom', source: 'boardRefs(...)' }],
      });
      expect((r as Record<string, unknown>).warnings).toEqual([
        { code: 'BOARD_REFS_ERROR', message: 'boardRefs boom', source: 'boardRefs(...)' },
      ]);
    });

    // ── errorCode threading (ERR-02 / CR-01 regression) ─────────────────────
    //
    // shapeResult is a manual allowlist (RESEARCH Pitfall 4) — errorCode added
    // to OpResult is invisible on the wire unless explicitly forwarded, just
    // like warnings above.

    it("forwards result.errorCode on a failing 'action' case", () => {
      const r = shapeResult('action', {
        success: false,
        error: 'It is not your turn.',
        errorCode: 'NOT_YOUR_TURN' as unknown as OpResult['errorCode'],
        snapshot: {},
        pendingState: null,
        flowState: {},
        playerViews: [],
        isComplete: false,
        winners: [],
      });
      expect((r as Record<string, unknown>).errorCode).toBe('NOT_YOUR_TURN');
    });

    it("forwards result.errorCode on a failing 'selection_step' case", () => {
      const r = shapeResult('selection_step', {
        success: false,
        error: 'Engine failed to process selection.',
        errorCode: 'ENGINE_ERROR' as unknown as OpResult['errorCode'],
        snapshot: {},
        pendingState: null,
        flowState: {},
        playerViews: [],
        isComplete: false,
        winners: [],
      });
      expect(r).toEqual({ success: false, error: 'Engine failed to process selection.', errorCode: 'ENGINE_ERROR' });
    });

    it('returns only {success,error} for hint and heatmap-toggle (no playerViews leak)', () => {
      const base = {
        success: true,
        snapshot: {},
        pendingState: null,
        flowState: {},
        playerViews: [{ state: { secret: 'should-not-appear' } }],
        isComplete: false,
        winners: [],
      };

      const hintResult = shapeResult('hint', base);
      expect(hintResult).toEqual({ success: true, error: undefined });
      expect((hintResult as Record<string, unknown>).playerViews).toBeUndefined();

      const heatmapResult = shapeResult('heatmap-toggle', base);
      expect(heatmapResult).toEqual({ success: true, error: undefined });
      expect((heatmapResult as Record<string, unknown>).playerViews).toBeUndefined();
    });

    it('returns only {success,error} for demo-start and demo-stop (no playerViews leak, RESEARCH Pitfall 7)', () => {
      const base = {
        success: true,
        snapshot: {},
        pendingState: null,
        flowState: {},
        playerViews: [{ state: { isDemoRunning: true } }],
        isComplete: false,
        winners: [],
      };

      const demoStartResult = shapeResult('demo-start', base);
      expect(demoStartResult).toEqual({ success: true, error: undefined });
      expect((demoStartResult as Record<string, unknown>).playerViews).toBeUndefined();
      expect((demoStartResult as Record<string, unknown>).isDemoRunning).toBeUndefined();

      const demoStopResult = shapeResult('demo-stop', base);
      expect(demoStopResult).toEqual({ success: true, error: undefined });
      expect((demoStopResult as Record<string, unknown>).playerViews).toBeUndefined();
    });
  });

  describe('handleServerRequest drives the host and posts in prod order', () => {
    it('calls handleOp with the translated Op and posts game_state THEN server_response', async () => {
      const { session, posted } = makeSession();
      await session.start();
      posted.length = 0; // ignore the opening broadcast

      // Spy on the real host's handleOp to confirm the translated Op.
      const handleOpCalls: Array<{ seat: number; op: unknown }> = [];
      const original = session.host.handleOp.bind(session.host);
      session.host.handleOp = (seat, op) => {
        handleOpCalls.push({ seat, op });
        return original(seat, op);
      };

      await session.handleServerRequest(1, 'req-0', 'action', { actionName: 'pass', args: {} });

      // (a) handleOp was called with the translated Op
      expect(handleOpCalls).toHaveLength(1);
      expect(handleOpCalls[0]).toEqual({
        seat: 1,
        op: { type: 'action', actionName: 'pass', player: 1, args: {} },
      });

      // (b) a game_state was posted BEFORE the server_response
      const firstResponseIdx = posted.findIndex((p) => p.kind === 'server_response');
      const firstStateIdx = posted.findIndex((p) => p.kind === 'game_state');
      expect(firstStateIdx).toBeGreaterThanOrEqual(0);
      expect(firstResponseIdx).toBeGreaterThanOrEqual(0);
      expect(firstStateIdx).toBeLessThan(firstResponseIdx);

      // The response goes to the requesting seat.
      expect(posted[firstResponseIdx].seat).toBe(1);
    });

    it('posts a failure response for an unknown wire op without touching the host', async () => {
      const { session, posted } = makeSession();
      await session.start();
      posted.length = 0;

      await session.handleServerRequest(1, 'req-x', 'teleport', {});

      expect(posted).toEqual([{ kind: 'server_response', seat: 1 }]);
    });
  });

  // ── teachingDisabled threading (Plan 111-02) ─────────────────────────────
  //
  // DevSessionOptions.teachingDisabled threads into SnapshotSessionHost's adapters,
  // so demoStart is rejected fail-loud and every broadcast view carries the flag.

  describe('teachingDisabled threading', () => {

    function makeLockedSession() {
      const stateViews: Array<Array<{ state: Record<string, unknown> }>> = [];
      const responses: Array<Record<string, unknown>> = [];
      const session = createDevSession({
        playerCount: 2,
        teachingDisabled: true,
        executeOp: (snap, pend, op) =>
          executeOp(simpleGameDef, op.type === 'start' ? gameOptions : { playerCount: 2 }, snap, pend, op),
        postGameState: (_seat, view) => {
          // Collect first postGameState call per broadcast cycle (both seats fire)
          const last = stateViews[stateViews.length - 1];
          if (!last) {
            stateViews.push([view as { state: Record<string, unknown> }]);
          } else {
            last.push(view as { state: Record<string, unknown> });
          }
        },
        postServerResponse: (_seat, _reqId, result) => responses.push(result),
      });
      return { session, stateViews, responses };
    }

    it('demoStart returns success:false error when teachingDisabled is set via DevSessionOptions', async () => {
      const { session, responses } = makeLockedSession();
      await session.start();
      responses.length = 0;

      await session.handleServerRequest(1, 'req-demo', 'demo-start', {});

      expect(responses).toHaveLength(1);
      expect(responses[0].success).toBe(false);
      expect(responses[0].error).toBe('Teaching features are disabled for this session.');
    });

    it('broadcast views carry state.teachingDisabled === true when DevSessionOptions.teachingDisabled is set', async () => {
      const { session, stateViews } = makeLockedSession();
      await session.start();

      // The start broadcast should already carry teachingDisabled on every seat view.
      expect(stateViews.length).toBeGreaterThanOrEqual(1);
      for (const broadcast of stateViews) {
        for (const view of broadcast) {
          expect(view.state.teachingDisabled).toBe(true);
        }
      }
    });

  });

  // ── debug wire ops ──────────────────────────────────────────────────────
  describe('debug wire ops', () => {
    /** A session that records the result payload of each server_response. */
    function makeResultSession() {
      const responses: Array<{ seat: number; result: Record<string, unknown> }> = [];
      let stateBroadcasts = 0;
      const session = createDevSession({
        playerCount: 2,
        executeOp: (snap, pend, op) =>
          executeOp(simpleGameDef, op.type === 'start' ? gameOptions : { playerCount: 2 }, snap, pend, op),
        postGameState: () => {
          stateBroadcasts++;
        },
        postServerResponse: (seat, _requestId, result) => responses.push({ seat, result }),
      });
      return { session, responses, broadcasts: () => stateBroadcasts };
    }

    async function pass(session: ReturnType<typeof makeResultSession>['session'], n: number) {
      for (let i = 0; i < n; i++) {
        await session.handleServerRequest(1, `a${i}`, 'action', { actionName: 'pass', args: {} });
      }
    }

    it('debug:history returns the action history (read-only, no broadcast)', async () => {
      const { session, responses, broadcasts } = makeResultSession();
      await session.start();
      await pass(session, 2);
      const before = broadcasts();

      await session.handleServerRequest(1, 'h', 'debug:history', {});

      const last = responses[responses.length - 1];
      expect(last.result.success).toBe(true);
      expect(last.result.actionHistory).toHaveLength(2);
      // Read-only: no new game_state broadcast.
      expect(broadcasts()).toBe(before);
    });

    it('debug:state-at returns historical state under the `state` key', async () => {
      const { session, responses } = makeResultSession();
      await session.start();
      await pass(session, 2);

      await session.handleServerRequest(1, 's', 'debug:state-at', { actionIndex: 1, player: 1 });

      const last = responses[responses.length - 1];
      expect(last.result.success).toBe(true);
      expect((last.result.state as { view: unknown }).view).toBeTruthy();
    });

    it('debug:rewind truncates history and broadcasts the new state', async () => {
      const { session, responses, broadcasts } = makeResultSession();
      await session.start();
      await pass(session, 3);
      const before = broadcasts();

      await session.handleServerRequest(1, 'r', 'debug:rewind', { actionIndex: 1 });
      const rewindResp = responses[responses.length - 1];
      expect(rewindResp.result.success).toBe(true);
      // Mutating: it broadcast new state to both seats.
      expect(broadcasts()).toBeGreaterThan(before);

      await session.handleServerRequest(1, 'h', 'debug:history', {});
      expect(responses[responses.length - 1].result.actionHistory).toHaveLength(1);
    });
  });

  // ── log-capture wiring (ERR-04) ──────────────────────────────────────────
  //
  // The dev-host ring buffer (log-capture.ts) is fed by three real sites:
  // (1) the onPersistenceError adapter supplied by createDevSession,
  // (2) OpResult.warnings on a resolved op (dual-channel — Plan 126-03),
  // (3) the bridge.ts:325 catch when a server_request throws.

  describe('log-capture wiring', () => {
    beforeEach(() => {
      clearEntries();
    });

    it('a persist() failure is captured via onPersistenceError, severity escalates with health', async () => {
      const session = createDevSession({
        playerCount: 1,
        persist: () => {
          throw new Error('disk full');
        },
        executeOp: (snap, pend, op) =>
          executeOp(simpleGameDef, op.type === 'start' ? { ...gameOptions, playerCount: 1 } : { playerCount: 1 }, snap, pend, op),
        postGameState: () => {},
        postServerResponse: () => {},
      });

      await session.start(); // failure 1 (healthy)
      await session.handleServerRequest(1, 'a1', 'action', { actionName: 'pass', args: {} }); // failure 2 (healthy)
      await session.handleServerRequest(1, 'a2', 'action', { actionName: 'pass', args: {} }); // failure 3 (unhealthy)

      const persistenceEntries = getEntries().filter((e) => e.source === 'persistence');
      expect(persistenceEntries).toHaveLength(3);
      expect(persistenceEntries[0]).toMatchObject({ severity: 'warning', message: 'disk full' });
      expect(persistenceEntries[1]).toMatchObject({ severity: 'warning' });
      expect(persistenceEntries[2]).toMatchObject({ severity: 'error' });
    });

    it("a resolved op's OpResult.warnings are captured as 'warning' entries sourced by the wireOp", async () => {
      const warningExecuteOp = (
        _snap: unknown,
        _pend: Record<string, unknown> | null,
        op: { type: string },
      ): Promise<OpResult> => {
        if (op.type === 'start') {
          return Promise.resolve({
            success: true,
            snapshot: {},
            pendingState: null,
            flowState: {},
            playerViews: [],
            isComplete: false,
            winners: [],
          });
        }
        return Promise.resolve({
          success: true,
          snapshot: {},
          pendingState: null,
          flowState: {},
          playerViews: [],
          isComplete: false,
          winners: [],
          warnings: [{ code: 'BOARD_REFS_ERROR', message: 'boardRefs boom', source: 'boardRefs(...)' }],
        });
      };
      const session = createDevSession({
        playerCount: 1,
        executeOp: warningExecuteOp,
        postGameState: () => {},
        postServerResponse: () => {},
      });

      await session.start();
      await session.handleServerRequest(1, 'r1', 'action', { actionName: 'pass', args: {} });

      const warningEntries = getEntries().filter((e) => e.source === 'action');
      expect(warningEntries).toHaveLength(1);
      expect(warningEntries[0]).toMatchObject({ severity: 'warning', message: 'boardRefs boom' });
    });

    it('a server_request that throws is captured as an error entry sourced by the wireOp (bridge.ts:325)', async () => {
      const responses: Array<Record<string, unknown>> = [];
      const throwingExecuteOp = (
        _snap: unknown,
        _pend: Record<string, unknown> | null,
        op: { type: string },
      ): Promise<OpResult> => {
        if (op.type === 'start') {
          return Promise.resolve({
            success: true,
            snapshot: {},
            pendingState: null,
            flowState: {},
            playerViews: [],
            isComplete: false,
            winners: [],
          });
        }
        throw new Error('executor boom');
      };
      const session = createDevSession({
        playerCount: 1,
        executeOp: throwingExecuteOp,
        postGameState: () => {},
        postServerResponse: (_seat, _reqId, result) => responses.push(result),
      });

      await session.start();
      await session.handleServerRequest(1, 'r', 'action', { actionName: 'pass', args: {} });

      expect(responses).toHaveLength(1);
      expect(responses[0].success).toBe(false);

      const errorEntries = getEntries().filter((e) => e.source === 'action' && e.severity === 'error');
      expect(errorEntries).toHaveLength(1);
      expect(errorEntries[0].message).toBe('executor boom');
    });
  });

  // ── debug:logs host-lifecycle op (ERR-04) ────────────────────────────────

  describe('debug:logs host-lifecycle op', () => {
    beforeEach(() => {
      clearEntries();
    });

    it("translateOp('debug:logs', ...) yields a host-lifecycle marker, not a member routed through executeOp", () => {
      expect(translateOp('debug:logs', 1, {})).toEqual({ type: 'debugLogs' });
    });

    it('debug:logs resolves with success:true and the captured entries (no snapshot round-trip)', async () => {
      const { session, responses } = makeResultSessionWithResponses();
      await session.start();
      const stateBefore = session.viewForSeat(1);

      // Seed the ring buffer directly (bypassing gameplay).
      const { record } = await import('./log-capture.js');
      record('warning', 'a captured warning', 'test');

      await session.handleServerRequest(1, 'l1', 'debug:logs', {});

      const last = responses[responses.length - 1];
      expect(last.result.success).toBe(true);
      expect(last.result.entries).toEqual(
        expect.arrayContaining([expect.objectContaining({ severity: 'warning', message: 'a captured warning', source: 'test' })]),
      );
      // No snapshot mutation: the (unused) view reference is unchanged.
      expect(session.viewForSeat(1)).toBe(stateBefore);
    });

    it("shapeResult('debug:logs', result) returns { success, error, entries }", () => {
      const r = shapeResult('debug:logs', {
        success: true,
        entries: [{ severity: 'warning', message: 'x', source: 'y', timestamp: 1 }],
      } as unknown as OpResult);
      expect(r).toEqual({
        success: true,
        error: undefined,
        entries: [{ severity: 'warning', message: 'x', source: 'y', timestamp: 1 }],
      });
    });

    it('regression: debugLogs is never added to the executeOp Op union / READ_ONLY_OP_TYPES (purity contract)', async () => {
      const stateless = await import('../../session/stateless-ops.js');
      expect(stateless.READ_ONLY_OP_TYPES.has('debugLogs' as never)).toBe(false);
    });
  });

  function makeResultSessionWithResponses() {
    const responses: Array<{ seat: number; result: Record<string, unknown> }> = [];
    const session = createDevSession({
      playerCount: 2,
      executeOp: (snap, pend, op) =>
        executeOp(simpleGameDef, op.type === 'start' ? gameOptions : { playerCount: 2 }, snap, pend, op),
      postGameState: () => {},
      postServerResponse: (seat, _requestId, result) => responses.push({ seat, result }),
    });
    return { session, responses };
  }
});
