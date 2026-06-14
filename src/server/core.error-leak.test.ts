import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameServerCore } from './core.js';
import type { GameStore, GameRegistry, ServerRequest } from './types.js';

/**
 * F15 regression: uncaught internal exceptions must NOT leak their raw message
 * (which can embed element ids, property paths, or class names) to clients.
 * The catch-all must return a generic message + correlation id, and log the
 * full error server-side only.
 */
describe('GameServerCore catch-all error handling (F15)', () => {
  // A message that simulates a leaky engine exception with internal structure.
  const INTERNAL_MESSAGE =
    "Cannot read property 'hiddenCard' of element Deck#42 at game.players[1].hand";

  let store: GameStore;
  let registry: GameRegistry;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store = {
      getGame: vi.fn(async () => {
        throw new Error(INTERNAL_MESSAGE);
      }),
      createGame: vi.fn(),
      deleteGame: vi.fn(),
    } as unknown as GameStore;

    registry = {
      get: () => undefined,
      getAll: () => [],
      set: () => {},
    };

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('does not leak the raw internal exception message to the client', async () => {
    const core = new GameServerCore({ store, registry });
    const request: ServerRequest = {
      method: 'GET',
      path: '/games/abc123',
      query: {},
    } as ServerRequest;

    const response = await core.handleRequest(request);
    const body = response.body as { success: boolean; error: string; errorId?: string };

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    // The raw internal details must NOT appear in the client-facing body.
    expect(JSON.stringify(body)).not.toContain('hiddenCard');
    expect(JSON.stringify(body)).not.toContain('Deck#42');
    expect(body.error).not.toBe(INTERNAL_MESSAGE);
    // A correlation id is returned and referenced in the generic message.
    expect(body.errorId).toBeDefined();
    expect(body.error).toContain(body.errorId!);
  });

  it('logs the full error server-side under the same correlation id', async () => {
    const core = new GameServerCore({ store, registry });
    const request: ServerRequest = {
      method: 'GET',
      path: '/games/abc123',
      query: {},
    } as ServerRequest;

    const response = await core.handleRequest(request);
    const body = response.body as { errorId: string };

    // The server log must contain both the correlation id and the real error,
    // so operators can still diagnose the failure.
    const loggedWithId = consoleErrorSpy.mock.calls.some(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes(body.errorId) &&
        call[1] instanceof Error &&
        (call[1] as Error).message === INTERNAL_MESSAGE
    );
    expect(loggedWithId).toBe(true);
  });
});
