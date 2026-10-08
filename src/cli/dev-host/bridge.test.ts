import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, type FollowUpOffer, type GameOptions, type GameStateSnapshot } from '../../engine/index.js';
import {
  executeOp,
  type ExecutableOp,
  type ExecuteOpAdapter,
  type GameDefinitionLike,
  type OpResult,
  type StateEnvelope,
} from '../../session/index.js';
import type { SerializedFlowDebugInfo } from '../../session/types.js';
import { ErrorCode } from '../../types/protocol.js';
import { createDevSession, translateOp, shapeResult } from './bridge.js';
import { boundaryKeyOfHost } from '../../session/testing/boundary-stamp.js';
import { getEntries, clearEntries, record } from './log-capture.js';
import { READ_ONLY_OP_TYPES } from '../../session/stateless-ops.js';

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
          do: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)! , turnScope: 'restart' }),
        }),
      }),
    );
  }
}

const simpleGameDef: GameDefinitionLike = {
  gameClass: SimpleGame,
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
    debug: () => false,
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

    it('never builds the host-only seat close from a client message', () => {
      // No wire op maps to it, under either spelling.
      expect(translateOp('expireSeat', 1, { player: 1, idleAction: 'pass', boundaryKey: 'k' })).toBeUndefined();
      expect(translateOp('expire_seat', 1, { player: 1, idleAction: 'pass', boundaryKey: 'k' })).toBeUndefined();
      // An action is rebuilt field by field, so nothing else a client sends rides along.
      expect(translateOp('action', 1, { actionName: 'pass', args: {}, boundaryKey: 'k', onTimeout: true, type: 'expireSeat' })).toEqual({
        type: 'action',
        actionName: 'pass',
        player: 1,
        args: {},
        boundaryKey: 'k',
      });
    });
  });

  describe('shapeResult', () => {
    /**
     * A game as an op result carries it: every seat's view and the whole
     * snapshot, none of which may reach the one seat a reply goes to.
     */
    const ENVELOPE: StateEnvelope = {
      snapshot: { flowState: { secret: 'snapshot' } } as unknown as GameStateSnapshot,
      playerViews: [{ state: { secret: 'should-not-appear' } }],
      spectatorView: { state: { secret: 'spectator' } },
      flowDebugInfo: {} as SerializedFlowDebugInfo,
      persistCommit: { private: { entries: [] } },
    };

    it('returns only the move outcome for an action', () => {
      const r = shapeResult('action', { success: true, ...ENVELOPE, followUp: { action: 'next' } as FollowUpOffer });
      expect(r).toEqual({ success: true, followUp: { action: 'next' } });
    });

    it('returns only the pick answer for resolveChoices (#450)', () => {
      const r = shapeResult('resolveChoices', { success: true, choices: [{ value: 'red', display: 'Red' }, { value: 'blue', display: 'Blue' }] });
      expect(r).toEqual({
        success: true,
        choices: [{ value: 'red', display: 'Red' }, { value: 'blue', display: 'Blue' }],
        validElements: undefined,
        multiSelect: undefined,
        orderedList: undefined,
        warnings: undefined,
      });
    });

    it('forwards the resolved ordered-list bounds for resolveChoices (#480)', () => {
      const r = shapeResult('resolveChoices', {
        success: true,
        choices: [{ value: 'university', display: 'University' }, { value: 'shipyard', display: 'Shipyard' }],
        orderedList: { min: 1, max: 3 },
      });
      expect(r.orderedList).toEqual({ min: 1, max: 3 });
    });

    // ── warnings threading (ERR-01 T-126-09) ────────────────────────────────
    //
    // shapeResult is an allowlist (RESEARCH Pitfall 4): a pick's warnings are
    // invisible on the wire unless explicitly forwarded.

    it('forwards a selection step\'s warnings', () => {
      const r = shapeResult('selectionStep', {
        success: true,
        ...ENVELOPE,
        pendingState: null,
        done: true,
        actionComplete: true,
        warnings: [{ code: 'DISPLAY_ERROR', message: 'display boom', source: 'display(...)' }],
      });
      expect(r.warnings).toEqual([{ code: 'DISPLAY_ERROR', message: 'display boom', source: 'display(...)' }]);
      expect(r).not.toHaveProperty('pendingState');
      expect(r).not.toHaveProperty('playerViews');
    });

    it('forwards a choices answer\'s warnings', () => {
      const r = shapeResult('resolveChoices', {
        success: true,
        choices: [{ value: 'red', display: 'Red' }, { value: 'blue', display: 'Blue' }],
        warnings: [{ code: 'BOARD_REFS_ERROR', message: 'boardRefs boom', source: 'boardRefs(...)' }],
      });
      expect(r.warnings).toEqual([{ code: 'BOARD_REFS_ERROR', message: 'boardRefs boom', source: 'boardRefs(...)' }]);
    });

    // ── errorCode threading (ERR-02 / CR-01 regression) ─────────────────────

    it('forwards a refused action\'s errorCode', () => {
      const r = shapeResult('action', {
        success: false,
        error: 'It is not your turn.',
        errorCode: ErrorCode.NOT_YOUR_TURN,
        category: 'bundle',
      });
      expect(r).toEqual({ success: false, error: 'It is not your turn.', errorCode: 'NOT_YOUR_TURN' });
    });

    it('forwards a refused selection step\'s errorCode', () => {
      const r = shapeResult('selectionStep', {
        success: false,
        error: 'Engine failed to process selection.',
        errorCode: ErrorCode.ENGINE_ERROR,
        category: 'bundle',
      });
      expect(r).toEqual({ success: false, error: 'Engine failed to process selection.', errorCode: 'ENGINE_ERROR' });
    });

    it('returns only {success,error} for hint and heatmapToggle (no playerViews leak)', () => {
      const annotation = { text: 'here' };
      const hintResult = shapeResult('hint', { success: true, ...ENVELOPE, hintAnnotation: { seat: 1, annotation } });
      expect(hintResult).toEqual({ success: true, error: undefined });

      const heatmapResult = shapeResult('heatmapToggle', {
        success: true,
        ...ENVELOPE,
        heatmapUpdate: { seat: 1, visible: true, entries: [] },
      });
      expect(heatmapResult).toEqual({ success: true, error: undefined });
    });

    it('returns only {success,error} for demoStart and demoStop (RESEARCH Pitfall 7)', () => {
      expect(shapeResult('demoStart', { success: true })).toEqual({ success: true, error: undefined });
      expect(shapeResult('demoStop', { success: true })).toEqual({ success: true, error: undefined });
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

      // Captured BEFORE the request: the op runs and the host moves on, so
      // re-reading the key afterwards would read the NEXT boundary.
      const submittedKey = boundaryKeyOfHost(session.host);
      await session.handleServerRequest(1, 'req-0', 'action', { actionName: 'pass', args: {}, boundaryKey: submittedKey });

      // (a) handleOp was called with the translated Op — including the client's
      // boundary key, forwarded verbatim (never replaced with the host's own).
      expect(handleOpCalls).toHaveLength(1);
      expect(handleOpCalls[0]).toEqual({
        seat: 1,
        op: { type: 'action', actionName: 'pass', player: 1, args: {}, boundaryKey: submittedKey },
      });
      expect(boundaryKeyOfHost(session.host)).not.toBe(submittedKey);

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
        debug: () => false,
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
        debug: () => true,
        playerCount: 2,
        executeOp: (snap, pend, op) =>
          executeOp(simpleGameDef, op.type === 'start' ? gameOptions : { playerCount: 2 }, snap, pend, op, { debug: true }),
        postGameState: () => {
          stateBroadcasts++;
        },
        postServerResponse: (seat, _requestId, result) => responses.push({ seat, result }),
      });
      return { session, responses, broadcasts: () => stateBroadcasts };
    }

    async function pass(session: ReturnType<typeof makeResultSession>['session'], n: number) {
      for (let i = 0; i < n; i++) {
        await session.handleServerRequest(1, `a${i}`, 'action', { actionName: 'pass', args: {}, boundaryKey: boundaryKeyOfHost(session.host) });
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
        debug: () => false,
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
      await session.handleServerRequest(1, 'a1', 'action', { actionName: 'pass', args: {}, boundaryKey: boundaryKeyOfHost(session.host) }); // failure 2 (healthy)
      await session.handleServerRequest(1, 'a2', 'action', { actionName: 'pass', args: {}, boundaryKey: boundaryKeyOfHost(session.host) }); // failure 3 (unhealthy)

      const persistenceEntries = getEntries().filter((e) => e.source === 'persistence');
      expect(persistenceEntries).toHaveLength(3);
      expect(persistenceEntries[0]).toMatchObject({ severity: 'warning', message: 'disk full' });
      expect(persistenceEntries[1]).toMatchObject({ severity: 'warning' });
      expect(persistenceEntries[2]).toMatchObject({ severity: 'error' });
    });

    it("a pick's warnings are captured as 'warning' entries sourced by the wireOp", async () => {
      const game: StateEnvelope = {
        snapshot: { flowState: {}, winners: [] } as unknown as GameStateSnapshot,
        playerViews: [],
        spectatorView: undefined,
        flowDebugInfo: {} as SerializedFlowDebugInfo,
        persistCommit: {},
      };
      const warningExecuteOp = ((_snap: unknown, _pend: unknown, op: ExecutableOp): Promise<OpResult> => {
        if (op.type === 'start') return Promise.resolve({ success: true, ...game });
        return Promise.resolve({
          success: true,
          ...game,
          pendingState: { picked: 'x' },
          warnings: [{ code: 'BOARD_REFS_ERROR', message: 'boardRefs boom', source: 'boardRefs(...)' }],
        });
      }) as ExecuteOpAdapter;
      const session = createDevSession({
        debug: () => false,
        playerCount: 1,
        executeOp: warningExecuteOp,
        postGameState: () => {},
        postServerResponse: () => {},
      });

      await session.start();
      await session.handleServerRequest(1, 'r1', 'selection_step', {
        selectionName: 'x', value: 1, boundaryKey: boundaryKeyOfHost(session.host),
      });

      const warningEntries = getEntries().filter((e) => e.source === 'selection_step');
      expect(warningEntries).toHaveLength(1);
      expect(warningEntries[0]).toMatchObject({ severity: 'warning', message: 'boardRefs boom' });
    });

    it('a server_request that throws is captured as an error entry sourced by the wireOp (bridge.ts:325)', async () => {
      const responses: Array<Record<string, unknown>> = [];
      const throwingExecuteOp = ((_snap: unknown, _pend: unknown, op: ExecutableOp): Promise<OpResult> => {
        if (op.type === 'start') {
          return Promise.resolve({
            success: true,
            snapshot: { flowState: {}, winners: [] } as unknown as GameStateSnapshot,
            playerViews: [],
            spectatorView: undefined,
            flowDebugInfo: {} as SerializedFlowDebugInfo,
          });
        }
        throw new Error('executor boom');
      }) as ExecuteOpAdapter;
      const session = createDevSession({
        debug: () => false,
        playerCount: 1,
        executeOp: throwingExecuteOp,
        postGameState: () => {},
        postServerResponse: (_seat, _reqId, result) => responses.push(result),
      });

      await session.start();
      await session.handleServerRequest(1, 'r', 'action', { actionName: 'pass', args: {}, boundaryKey: boundaryKeyOfHost(session.host) });

      expect(responses).toHaveLength(1);
      expect(responses[0].success).toBe(false);

      const errorEntries = getEntries().filter((e) => e.source === 'action' && e.severity === 'error');
      expect(errorEntries).toHaveLength(1);
      expect(errorEntries[0].message).toBe('executor boom');
    });
  });

  // ── #481: debug ops need debugging on, and read only the asking seat ──────
  describe('debug gate (#481)', () => {
    function sessionWithDebug(debug: boolean) {
      const responses: Array<{ seat: number; result: Record<string, unknown> }> = [];
      const session = createDevSession({
        playerCount: 2,
        debug: () => debug,
        executeOp: (snap, pend, op) =>
          executeOp(simpleGameDef, op.type === 'start' ? gameOptions : { playerCount: 2 }, snap, pend, op, { debug }),
        postGameState: () => {},
        postServerResponse: (seat, _requestId, result) => responses.push({ seat, result }),
      });
      return { session, responses };
    }

    it('pins every seat-view debug op to the asking seat, whatever seat the payload names', () => {
      expect(translateOp('debug:state-at', 2, { actionIndex: 1, player: 1 })).toEqual({
        type: 'debugStateAt', actionIndex: 1, player: 2,
      });
      expect(translateOp('debug:state-diff', 2, { fromIndex: 0, toIndex: 1, player: 1 })).toEqual({
        type: 'debugStateDiff', fromIndex: 0, toIndex: 1, player: 2,
      });
      expect(translateOp('debug:action-traces', 2, { player: 1 })).toEqual({ type: 'debugActionTraces', player: 2 });
      expect(translateOp('debug:flow-state', 2, { player: 1 })).toEqual({ type: 'debugFlowState', player: 2 });
    });

    it('pins hint and heatmap-toggle to the asking seat, whatever seat the payload names', () => {
      expect(translateOp('hint', 2, { seat: 1 })).toEqual({ type: 'hint', seat: 2 });
      expect(translateOp('heatmap-toggle', 2, { seat: 1, visible: true })).toEqual({
        type: 'heatmapToggle', seat: 2, visible: true,
      });
    });

    it('reads whether debugging is on at every request, so it can change while the session runs', async () => {
      let debug = true;
      const responses: Array<Record<string, unknown>> = [];
      const session = createDevSession({
        playerCount: 2,
        debug: () => debug,
        executeOp: (snap, pend, op) =>
          executeOp(simpleGameDef, op.type === 'start' ? gameOptions : { playerCount: 2 }, snap, pend, op, { debug }),
        postGameState: () => {},
        postServerResponse: (_seat, _requestId, result) => responses.push(result),
      });
      await session.start();
      await session.handleServerRequest(1, 'a', 'debug:history', {});
      await session.handleServerRequest(1, 'b', 'debug:logs', {});
      debug = false;
      await session.handleServerRequest(1, 'c', 'debug:history', {});
      await session.handleServerRequest(1, 'd', 'debug:logs', {});
      expect(responses.map((r) => r.success)).toEqual([true, true, false, false]);
    });

    for (const [wireOp, payload] of [
      ['debug:history', {}],
      ['debug:state-at', { actionIndex: 0 }],
      ['debug:state-diff', { fromIndex: 0, toIndex: 0 }],
      ['debug:action-traces', {}],
      ['debug:flow-state', {}],
      ['debug:rewind', { actionIndex: 0 }],
      ['debug:move-to-top', { cardId: 1 }],
      ['debug:reorder-card', { cardId: 1, targetIndex: 0 }],
      ['debug:transfer-card', { cardId: 1, targetDeckId: 1 }],
      ['debug:shuffle-deck', { deckId: 1 }],
      ['debug:logs', {}],
    ] as const) {
      it(`refuses ${wireOp} when the session was created without debugging`, async () => {
        clearEntries();
        record('warning', 'only a debugger may read this', 'test');
        const { session, responses } = sessionWithDebug(false);
        await session.start();

        await session.handleServerRequest(1, 'd', wireOp, { ...payload });

        const last = responses[responses.length - 1];
        expect(last.result.success).toBe(false);
        expect(last.result.error).toMatch(/debugging is not turned on/i);
        expect(last.result.entries).toBeUndefined();
      });
    }

    it('answers debug ops when the session was created with debugging on', async () => {
      const { session, responses } = sessionWithDebug(true);
      await session.start();
      await session.handleServerRequest(1, 'h', 'debug:history', {});
      expect(responses[responses.length - 1].result.success).toBe(true);
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

    it('regression: debugLogs is never added to the executeOp Op union / READ_ONLY_OP_TYPES (purity contract)', () => {
      expect(READ_ONLY_OP_TYPES.has('debugLogs' as never)).toBe(false);
    });
  });

  function makeResultSessionWithResponses() {
    const responses: Array<{ seat: number; result: Record<string, unknown> }> = [];
    const session = createDevSession({
      debug: () => true,
      playerCount: 2,
      executeOp: (snap, pend, op) =>
        executeOp(simpleGameDef, op.type === 'start' ? gameOptions : { playerCount: 2 }, snap, pend, op, { debug: true }),
      postGameState: () => {},
      postServerResponse: (seat, _requestId, result) => responses.push({ seat, result }),
    });
    return { session, responses };
  }
});
