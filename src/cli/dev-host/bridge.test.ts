import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike } from '../../session/index.js';
import { createDevSession, translateOp, shapeResult } from './bridge.js';

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
});
