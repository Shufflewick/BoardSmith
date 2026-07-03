/**
 * Browserless Node integration test — the phase's literal acceptance proof.
 *
 * Stands up a REAL `ws` `WebSocketServer({ port: 0 })` wired to `MultiplayerHost`
 * exactly as `src/cli/commands/dev.ts` does (minus Vite's httpServer), then
 * drives the full agent flow with `createDevHostClient` over a real socket:
 * connect -> hello -> getLobby -> join -> getState -> action -> debugToggle/uiSwitch.
 *
 * Exercises DRIVE-01 (getState/getLobby), DRIVE-02 (a browserless Node client
 * speaking real WS), and DRIVE-03 (debugToggle/uiSwitch relay) in one flow.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocketServer, WebSocket as NodeWebSocket } from 'ws';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../../engine/index.js';
import { executeOp, ErrorCode, type GameDefinitionLike } from '../../session/index.js';
import { MultiplayerHost, type ClientInbound } from './multiplayer-host.js';
import { createDevHostClient, type DevHostInboundMessage } from '../../client/dev-host-client.js';

/**
 * Minimal always-live game: seat 1 alone may act, mirroring multiplayer-host.test.ts's PassGame.
 *
 * Also registers `twoStep` — a deliberately minimal 2-selection action (also
 * restricted to seat 1) so this suite can exercise a genuinely in-progress
 * `pendingAction` (submit selection 1 of 2, never selection 2) and a
 * `resolveChoices`-sourced warning (its first selection's `boardRefs()`
 * deliberately throws) without inventing a whole new game/fixture.
 */
class PassGame extends Game<PassGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.registerAction(
      Action.create('twoStep')
        .chooseFrom('first', {
          choices: ['a', 'b'],
          // Deliberately throws so `resolve_choices` surfaces a real
          // BOARD_REFS_ERROR warning through the actual wire path (v4.4
          // milestone-audit gap #4: debug:logs / ERR-04).
          boardRefs: () => {
            throw new Error('dev-host-integration test: boardRefs() deliberately throws');
          },
        })
        .chooseFrom('second', { choices: ['x', 'y'] })
        .execute(() => ({ success: true })),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          do: actionStep({ actions: ['pass', 'twoStep'], player: (ctx) => ctx.game.getPlayer(1)! }),
        }),
      }),
    );
  }
}

const gameDef: GameDefinitionLike = {
  gameClass: PassGame as new (...args: unknown[]) => unknown,
  gameType: 'pass',
  minPlayers: 1,
  maxPlayers: 2,
};

/** Poll until `predicate()` is true or `timeoutMs` elapses (host state changes asynchronously). */
async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition never became true');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('dev-host integration: createDevHostClient against a real in-process WS server', () => {
  let wss: WebSocketServer;
  let host: MultiplayerHost;
  let port: number;
  const sockets = new Map<string, NodeWebSocket>();
  let clientCounter = 0;

  beforeAll(async () => {
    host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 1,
      makeSeed: () => 'dev-host-integration',
      executeOp: (gameOptions, snapshot, pendingState, op, hostOptions) =>
        executeOp(gameDef, gameOptions, snapshot, pendingState, op, hostOptions),
      send: (clientId, message) => {
        const sock = sockets.get(clientId);
        if (sock && sock.readyState === sock.OPEN) sock.send(JSON.stringify(message));
      },
    });

    wss = new WebSocketServer({ port: 0 });

    // Mirrors dev.ts:559-583 minus the Vite httpServer/upgrade routing: each
    // connection gets its own clientId (assigned at connection rather than
    // gated behind a 'hello' text frame, so a scripted client can observe the
    // host's true pre-hello 'lobby' phase via getLobby before any client has
    // ever said hello). Every message (including 'hello') is still forwarded
    // to MultiplayerHost.handleMessage exactly as dev.ts's dispatch() does.
    wss.on('connection', (socket) => {
      const clientId = `client-${++clientCounter}`;
      sockets.set(clientId, socket);
      socket.on('message', (raw) => {
        let msg: ClientInbound;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        Promise.resolve(host.handleMessage(clientId, msg)).catch((err) => {
          throw err instanceof Error ? err : new Error(String(err));
        });
      });
      socket.on('close', () => {
        sockets.delete(clientId);
        host.disconnect(clientId);
      });
    });

    await new Promise<void>((resolve) => wss.once('listening', resolve));
    const address = wss.address();
    if (typeof address === 'string' || address === null) {
      throw new Error('Expected an AddressInfo from WebSocketServer({ port: 0 }).');
    }
    port = address.port;
  });

  afterAll(async () => {
    for (const sock of sockets.values()) sock.close();
    sockets.clear();
    await new Promise<void>((resolve, reject) => {
      wss.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('drives connect -> hello -> getLobby -> join -> getState -> action -> debugToggle/uiSwitch', async () => {
    const url = `ws://localhost:${port}`;

    // ── Client A: connect, observe the true pre-game lobby phase, then hello. ──
    const clientA = createDevHostClient(url);
    await clientA.opened;

    const lobbyBeforeStart = await clientA.getLobby();
    expect(lobbyBeforeStart.phase).toBe('lobby');
    expect(lobbyBeforeStart.playerCount).toBe(2);
    expect(lobbyBeforeStart.minPlayers).toBe(1);

    // The FIRST hello system-wide auto-seats A into seat 1 and starts the game
    // (MultiplayerHost is "always live" — see multiplayer-host.ts:hello()).
    clientA.hello();
    await waitFor(async () => (await clientA.getLobby()).phase === 'playing');

    const lobbyAfterStart = await clientA.getLobby();
    expect(lobbyAfterStart.phase).toBe('playing');

    // ── DRIVE-01: getState returns the caller's OWN seat view, requestId echoed. ──
    const stateA = await clientA.getState();
    expect(stateA.view).toBeTruthy();
    const seatAView = stateA.view as { state: { isMyTurn: boolean } };
    expect(seatAView.state.isMyTurn).toBe(true); // seat 1 acts first in PassGame

    // ── A second scripted client joins the open (AI) seat 2. ──
    const clientB = createDevHostClient(url);
    await clientB.opened;
    clientB.hello();
    await waitFor(() => sockets.size === 2);
    clientB.join(2);
    await waitFor(async () => {
      try {
        const s = await clientB.getState();
        return s.view !== undefined;
      } catch {
        return false;
      }
    });

    // T-127-07: B's getState must return ONLY seat 2's view, never seat 1's.
    const stateB = await clientB.getState();
    const seatBView = stateB.view as { state: { isMyTurn: boolean } };
    expect(seatBView.state.isMyTurn).toBe(false); // only seat 1 may act in PassGame
    expect(stateB.view).not.toEqual(stateA.view);

    // ── Perform an action via serverRequest (seat 1, held by A). ──
    const actionResult = await clientA.serverRequest('action', { actionName: 'pass', args: {} });
    expect(actionResult.success).toBe(true);

    // ── v4.4 milestone-audit gap #1 (Phase 123 payload): debug:flow-state's
    //    flowDebugInfo carries a non-empty, precomputed `description` string.
    //    `getState`/`game_state` never carries flowDebugInfo (T-123-10) — it is
    //    scoped to the debug:flow-state wire op, which this asserts directly. ──
    const flowStateA = await clientA.serverRequest('debug:flow-state', {});
    expect(flowStateA.success).toBe(true);
    const flowDebugInfoA = flowStateA.flowDebugInfo as { description: string };
    expect(flowDebugInfoA).toBeTruthy();
    expect(typeof flowDebugInfoA.description).toBe('string');
    expect(flowDebugInfoA.description.length).toBeGreaterThan(0);
    // No action in progress yet — pendingAction is absent for seat 1 too.
    expect(flowStateA.pendingAction).toBeUndefined();

    // ── v4.4 milestone-audit gap #2: a seat-scoped, in-progress pendingAction.
    //    Submit ONLY the first of `twoStep`'s two selections (never the
    //    second) via `selection_step`, so the action stays pending. ──
    const stepResult = await clientA.serverRequest('selection_step', {
      actionName: 'twoStep',
      selectionName: 'first',
      value: 'a',
    });
    expect(stepResult.success).toBe(true);
    expect(stepResult.actionComplete).toBe(false);

    // `debug:flow-state` is always scoped to the CALLER's own seat (IN-01) —
    // A (seat 1, the acting seat) sees its own pendingAction; B (seat 2) does not.
    const flowStateAPending = await clientA.serverRequest('debug:flow-state', {});
    const pendingActionA = flowStateAPending.pendingAction as { actionName: string } | undefined;
    expect(pendingActionA).toBeTruthy();
    expect(pendingActionA?.actionName).toBe('twoStep');

    const flowStateB = await clientB.serverRequest('debug:flow-state', {});
    expect(flowStateB.pendingAction).toBeUndefined();

    // ── v4.4 milestone-audit gap #3 (Phase 126 payload): a failing action
    //    (B acting out of turn — only seat 1 may act in PassGame) round-trips
    //    a real, host-sourced `errorCode` to the Node client, not just a message. ──
    const wrongTurnResult = await clientB.serverRequest('action', { actionName: 'pass', args: {} });
    expect(wrongTurnResult.success).toBe(false);
    expect(wrongTurnResult.errorCode).toBe(ErrorCode.NOT_YOUR_TURN);

    // ── v4.4 milestone-audit gap #4 (Phase 126 ERR-04 leg): a genuine warning
    //    recorded through the real wire path (twoStep's first selection's
    //    boardRefs() throws during resolve_choices — see PassGame above) is
    //    retrievable afterward via the `debug:logs` op. ──
    const resolveChoicesResult = await clientA.serverRequest('resolve_choices', {
      actionName: 'twoStep',
      selectionName: 'first',
      args: {},
    });
    expect(resolveChoicesResult.success).toBe(true);
    expect(
      (resolveChoicesResult.warnings as Array<{ code: string }> | undefined)?.some(
        (w) => w.code === 'BOARD_REFS_ERROR',
      ),
    ).toBe(true);

    const logsResult = await clientA.serverRequest('debug:logs', {});
    expect(logsResult.success).toBe(true);
    const logEntries = logsResult.entries as Array<{ severity: string; message: string; source: string }>;
    expect(
      logEntries.some(
        (e) => e.severity === 'warning' && e.message.includes('boardRefs() deliberately throws'),
      ),
    ).toBe(true);

    // Leave `twoStep` mid-flight without completing it — cancel so the flow
    // isn't left awaiting the never-to-arrive second selection for the rest
    // of this suite (the subsequent tests only rely on getState/getLobby
    // guard clauses, not on the action step being resolved, but cancelling
    // keeps this test's own side effects self-contained).
    const cancelResult = await clientA.serverRequest('cancel_action', {});
    expect(cancelResult.success).toBe(true);

    // ── DRIVE-03: debugToggle/uiSwitch are relay-only fan-out to every connected client. ──
    const bMessages: DevHostInboundMessage[] = [];
    const unsubscribe = clientB.onMessage((msg) => bMessages.push(msg));
    clientA.debugToggle();
    clientA.uiSwitch('custom-ui');
    await waitFor(() => bMessages.some((m) => m.type === 'uiSwitch'));
    expect(bMessages.some((m) => m.type === 'debugToggle')).toBe(true);
    expect(bMessages.some((m) => m.type === 'uiSwitch' && m.name === 'custom-ui')).toBe(true);
    unsubscribe();

    clientA.close();
    clientB.close();
  });

  it('rejects requestId-correlated requests with an actionable message when the socket never opens', async () => {
    // Fail-loud when the request is issued before the connection is ready —
    // no requestId correlation is possible on a socket that isn't open yet.
    // No `.opened.catch(() => {})` workaround needed (CR-03): the SDK attaches
    // its own internal no-op handler so a caller who never touches `.opened`
    // at all doesn't crash the process with an unhandled rejection.
    const deadClient = createDevHostClient('ws://localhost:1', { requestTimeoutMs: 50 });
    await expect(deadClient.getLobby()).rejects.toThrow(/socket is not open/);
    deadClient.close();
  });

  it('rejects a correlated getState request promptly with the host error, not a timeout (CR-01)', async () => {
    // By this point in the suite the game is already 'playing' with both
    // seats claimed by clientA/clientB — a fresh client that never joins a
    // seat is unseated. getState's guard clause ("You are not seated in this
    // game.") must reject the promise immediately via requestId correlation —
    // NOT fall through to the (much longer) generic timeout.
    const unseatedClient = createDevHostClient(`ws://localhost:${port}`, { requestTimeoutMs: 5000 });
    await unseatedClient.opened;
    const start = Date.now();
    await expect(unseatedClient.getState()).rejects.toThrow(/not seated in this game/);
    expect(Date.now() - start).toBeLessThan(1000); // rejected fast, not via the 5s timeout
    unseatedClient.close();
  });

  it('rejects a pending request immediately when the socket closes mid-request (CR-02)', async () => {
    const client = createDevHostClient(`ws://localhost:${port}`, { requestTimeoutMs: 5000 });
    await client.opened;
    const pendingRequest = client.getState(); // no reply will ever arrive before close()
    client.close();
    await expect(pendingRequest).rejects.toThrow(/connection to .* closed/);
  });

  it('rejects requestId-correlated requests with a timeout when the socket is open but nothing replies', async () => {
    // A real, open socket to a server that never responds — exercises the
    // requestId-correlation timeout-reject fallback specifically (distinct
    // from the "socket not open" fail-loud path above).
    const silentServer = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => silentServer.once('listening', resolve));
    const silentAddress = silentServer.address();
    if (typeof silentAddress === 'string' || silentAddress === null) {
      throw new Error('Expected an AddressInfo from WebSocketServer({ port: 0 }).');
    }
    try {
      const silentClient = createDevHostClient(`ws://localhost:${silentAddress.port}`, {
        requestTimeoutMs: 50,
      });
      await silentClient.opened;
      await expect(silentClient.getLobby()).rejects.toThrow(/timed out after 50ms/);
      silentClient.close();
    } finally {
      await new Promise<void>((resolve, reject) => {
        silentServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
