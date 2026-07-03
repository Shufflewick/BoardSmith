import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MeepleClient, MeepleClientError } from './client.js';
import { ErrorCode } from '../types/protocol.js';

/**
 * Fetch-mocked contract sweep for MeepleClient (SDK-03, PROC-02
 * regressions). Adapted from game-connection.test.ts's structural pattern
 * (fake transport injected via vi.stubGlobal), but for `fetch` instead of a
 * WebSocket constructor.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * One entry per public MeepleClient HTTP method that is expected to route
 * through the shared `parseResponse` helper (i.e. every method except
 * `health()`, which is deliberately exempt — see F25 scope boundary).
 */
function methodTable(client: MeepleClient): Array<{ name: string; call: () => Promise<unknown> }> {
  return [
    { name: 'findMatch', call: () => client.findMatch('hex', { playerCount: 2 }) },
    { name: 'getMatchStatus', call: () => client.getMatchStatus() },
    { name: 'leaveMatchmaking', call: () => client.leaveMatchmaking() },
    { name: 'createGame', call: () => client.createGame({ gameType: 'hex', playerCount: 2 }) },
    { name: 'getGameState', call: () => client.getGameState('game-1') },
    { name: 'performAction', call: () => client.performAction('game-1', 'move', 1, {}) },
    { name: 'getHistory', call: () => client.getHistory('game-1') },
    { name: 'restartGame', call: () => client.restartGame('game-1') },
    { name: 'getLobby', call: () => client.getLobby('game-1') },
    { name: 'claimSeat', call: () => client.claimSeat('game-1', 1, 'Alice') },
    { name: 'joinLobby', call: () => client.joinLobby('game-1', 'Alice') },
    { name: 'updateLobbyName', call: () => client.updateLobbyName('game-1', 'Alice') },
    { name: 'setReady', call: () => client.setReady('game-1', true) },
    { name: 'addSlot', call: () => client.addSlot('game-1') },
    { name: 'removeSlot', call: () => client.removeSlot('game-1', 2) },
    { name: 'setSlotAI', call: () => client.setSlotAI('game-1', 2, true) },
    { name: 'leavePosition', call: () => client.leavePosition('game-1') },
    { name: 'kickPlayer', call: () => client.kickPlayer('game-1', 2) },
    { name: 'updatePlayerOptions', call: () => client.updatePlayerOptions('game-1', {}) },
    {
      name: 'updateSlotPlayerOptions',
      call: () => client.updateSlotPlayerOptions('game-1', 2, {}),
    },
    { name: 'updateGameOptions', call: () => client.updateGameOptions('game-1', {}) },
  ];
}

describe('MeepleClient error contract (SDK-03/F25)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: MeepleClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new MeepleClient({ baseUrl: 'http://localhost:3000', playerId: 'player-1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('18-method !success throw sweep', () => {
    for (const { name, call } of methodTable(new MeepleClient({ baseUrl: 'http://x' }))) {
      it(`${name} throws a MeepleClientError carrying the server error + errorCode on !success`, async () => {
        fetchMock.mockResolvedValue(
          jsonResponse({
            success: false,
            error: `${name} failed on the server`,
            errorCode: ErrorCode.NOT_YOUR_TURN,
          })
        );

        const entry = methodTable(client).find(e => e.name === name)!;

        let thrown: unknown;
        try {
          await entry.call();
          expect.unreachable('expected call to throw');
        } catch (err) {
          thrown = err;
        }

        expect(thrown).toBeInstanceOf(MeepleClientError);
        expect((thrown as Error).message).toBe(`${name} failed on the server`);
        expect((thrown as MeepleClientError).errorCode).toBe(ErrorCode.NOT_YOUR_TURN);
      });
    }
  });

  describe('non-2xx non-JSON response sweep', () => {
    for (const { name, call } of methodTable(new MeepleClient({ baseUrl: 'http://x' }))) {
      it(`${name} throws an actionable HTTP error (not a SyntaxError) on a non-2xx non-JSON body`, async () => {
        fetchMock.mockResolvedValue(new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' }));

        const entry = methodTable(client).find(e => e.name === name)!;

        let thrown: unknown;
        try {
          await entry.call();
          expect.unreachable('expected call to throw');
        } catch (err) {
          thrown = err;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(thrown).not.toBeInstanceOf(SyntaxError);
        expect((thrown as Error).message).toMatch(/HTTP 502/);
      });
    }
  });

  it('a lobby method with no errorCode in the body throws with errorCode undefined (never fabricated)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: 'Seat already claimed' })
    );

    try {
      await client.claimSeat('game-1', 1, 'Alice');
      expect.unreachable('expected claimSeat to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MeepleClientError);
      expect((err as MeepleClientError).errorCode).toBeUndefined();
    }
  });

  it('health() is unchanged — not routed through the throwing helper, returns raw JSON even on !success-shaped bodies', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok', environment: 'test' }));

    const result = await client.health();

    expect(result).toEqual({ status: 'ok', environment: 'test' });
  });
});
