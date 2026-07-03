/**
 * GameShell.joinGame — legacy direct-join fall-through predicate (WR-02).
 *
 * Mirrors the exact catch-block predicate in GameShell.vue's joinGame()
 * (same canary pattern as GameShell.action-help.test.ts): if GameShell
 * changes the predicate, this mirror must receive the same change.
 *
 * Contract: after getLobby(gid) throws, GameShell falls through to the
 * legacy direct join only when the server answered "no lobby / lobby-state
 * problem" — i.e. an HTTP 404 (server without lobby support) or a
 * MeepleClientError (server answered with a game/lobby state error).
 * Network failures and infrastructure errors (5xx) must surface to the
 * user, not silently degrade into a direct join.
 */

import { describe, it, expect } from 'vitest';
import { MeepleClientError } from '../../client/index.js';

// ── Mirrored from GameShell.vue shouldFallThroughToDirectJoin() ─────────────
function shouldFallThroughToDirectJoin(e: unknown): boolean {
  const is404 = e instanceof Error && /HTTP 404/.test(e.message);
  const isClientErr = e instanceof MeepleClientError;
  return is404 || isClientErr;
}
// ─────────────────────────────────────────────────────────────────────────────

describe('joinGame legacy fall-through predicate (WR-02)', () => {
  it('falls through on HTTP 404 (server without lobby support — parseResponse shape)', () => {
    // parseResponse throws `HTTP 404: Not Found` — no lowercase 'lobby' text.
    expect(shouldFallThroughToDirectJoin(new Error('HTTP 404: Not Found'))).toBe(true);
  });

  it('falls through on MeepleClientError (server answered with a lobby/game-state error)', () => {
    expect(shouldFallThroughToDirectJoin(new MeepleClientError('Game already started'))).toBe(
      true
    );
  });

  it('rethrows network failures (no fall-through)', () => {
    expect(shouldFallThroughToDirectJoin(new TypeError('fetch failed'))).toBe(false);
  });

  it('rethrows infrastructure errors like HTTP 502 (no fall-through)', () => {
    expect(shouldFallThroughToDirectJoin(new Error('HTTP 502: Bad Gateway'))).toBe(false);
  });
});
