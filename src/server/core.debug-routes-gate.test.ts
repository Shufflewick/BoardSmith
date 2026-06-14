import { describe, it, expect } from 'vitest';
import { GameServerCore } from './core.js';
import type {
  GameStore,
  GameRegistry,
  ServerRequest,
  GameServerCoreOptions,
} from './types.js';

/**
 * F12 regression: debug / integrity-sensitive routes must NOT be reachable
 * unless the server is explicitly running in a development environment.
 *
 * These routes can stack a deck, transfer cards between decks, reshuffle,
 * rewind away other players' moves, or dump the full action history (which can
 * reveal hidden information via replay). The server layer has no per-request
 * auth, so they must be closed by default and only opened in development.
 */

// A session stub that succeeds for every gated operation, so that *reaching*
// the handler is observable as a 200 (rather than a 404 from the gate).
function makeSession() {
  return {
    getHistory: () => ({ actions: [], commands: [] }),
    getStateAtAction: () => ({ success: true, state: { secret: 'hidden' } }),
    getStateDiff: () => ({ success: true, diff: {} }),
    getActionTraces: () => ({ success: true, traces: [], flowContext: {} }),
    rewindToAction: async () => ({ success: true, actionsDiscarded: 3 }),
    moveCardToTop: () => ({ success: true }),
    reorderCard: () => ({ success: true }),
    transferCard: () => ({ success: true }),
    shuffleDeck: () => ({ success: true }),
  };
}

function makeCore(environment?: string): GameServerCore {
  const store = {
    getGame: async () => makeSession(),
    createGame: async () => {},
    deleteGame: async () => {},
  } as unknown as GameStore;

  const registry: GameRegistry = {
    get: () => undefined,
    getAll: () => [],
    set: () => {},
  };

  const options: GameServerCoreOptions = { store, registry, environment };
  return new GameServerCore(options);
}

// Every route the F12 gate protects, with the method it is mounted under.
const GATED_ROUTES: Array<{ name: string; req: ServerRequest }> = [
  { name: 'history', req: { method: 'GET', path: '/games/g1/history', query: {} } },
  { name: 'state-at', req: { method: 'GET', path: '/games/g1/state-at/0', query: {} } },
  { name: 'action-traces', req: { method: 'GET', path: '/games/g1/action-traces', query: {} } },
  { name: 'rewind', req: { method: 'POST', path: '/games/g1/rewind', query: {}, body: { actionIndex: 0 } } },
  { name: 'move-to-top', req: { method: 'POST', path: '/games/g1/debug/move-to-top', query: {}, body: { cardId: 1 } } },
  { name: 'reorder-card', req: { method: 'POST', path: '/games/g1/debug/reorder-card', query: {}, body: { cardId: 1, targetIndex: 0 } } },
  { name: 'transfer-card', req: { method: 'POST', path: '/games/g1/debug/transfer-card', query: {}, body: { cardId: 1, targetDeckId: 2 } } },
  { name: 'shuffle-deck', req: { method: 'POST', path: '/games/g1/debug/shuffle-deck', query: {}, body: { deckId: 1 } } },
] as unknown as Array<{ name: string; req: ServerRequest }>;

describe('GameServerCore debug-route gate (F12)', () => {
  describe('environment unset (secure by default)', () => {
    const core = makeCore(undefined);
    for (const { name, req } of GATED_ROUTES) {
      it(`returns 404 for ${name}`, async () => {
        const res = await core.handleRequest(req);
        expect(res.status).toBe(404);
        // The generic router 404 ("Not found"), NOT the handler's
        // "Game not found" — proving the handler was never reached.
        expect((res.body as { error: string }).error).toBe('Not found');
      });
    }
  });

  describe("environment 'production'", () => {
    const core = makeCore('production');
    for (const { name, req } of GATED_ROUTES) {
      it(`returns 404 for ${name}`, async () => {
        const res = await core.handleRequest(req);
        expect(res.status).toBe(404);
        expect((res.body as { error: string }).error).toBe('Not found');
      });
    }
  });

  describe("environment 'development' (opt-in)", () => {
    const core = makeCore('development');
    for (const { name, req } of GATED_ROUTES) {
      it(`reaches the handler (200) for ${name}`, async () => {
        const res = await core.handleRequest(req);
        expect(res.status).toBe(200);
        expect((res.body as { success: boolean }).success).toBe(true);
      });
    }
  });

  it('does not affect non-debug routes (state-diff stays available in production)', async () => {
    // state-diff powers production replay/animation and must NOT be gated.
    const core = makeCore('production');
    const res = await core.handleRequest({
      method: 'GET',
      path: '/games/g1/state-diff/0/1',
      query: {},
    } as ServerRequest);
    // It is routed to its handler and succeeds — crucially NOT the gate's 404.
    expect(res.status).toBe(200);
  });
});
