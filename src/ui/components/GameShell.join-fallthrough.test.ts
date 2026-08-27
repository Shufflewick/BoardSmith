/**
 * GameShell.joinGame — direct-join fall-through predicate (WR-02, narrowed by #63).
 *
 * The predicate itself is imported now. It used to be a hand-copied mirror of the
 * catch block inside GameShell.vue's joinGame(), kept in sync by a comment; the
 * lobby extraction (#41) gave it a name in a module, so the test drives the real
 * one and the mirror cannot drift.
 *
 * Contract: after getLobby(gid) throws, GameShell falls through to a direct
 * join only when the SERVER ANSWERED with a game/lobby state error — a
 * MeepleClientError, which is how "this game is already in progress" arrives.
 * Everything else surfaces to the user:
 *
 * - HTTP 404 used to fall through, on the theory that the server might be an
 *   old-style one with no lobby endpoint. That is a backward-compatibility
 *   branch in a library that bans them, and it also swallowed the far more
 *   common case: a mistyped game code. A 404 is now an error the user sees.
 * - Network failures and infrastructure errors (5xx) were never fallen through
 *   and still are not.
 */

import { describe, it, expect } from 'vitest';
import { MeepleClientError } from '../../client/index.js';
import { shouldFallThroughToDirectJoin } from '../composables/useLobby.js';

describe('joinGame direct-join fall-through predicate (WR-02 / #63)', () => {
  it('falls through on MeepleClientError (server answered with a lobby/game-state error)', () => {
    expect(shouldFallThroughToDirectJoin(new MeepleClientError('Game already started'))).toBe(
      true
    );
  });

  it('surfaces HTTP 404 rather than degrading — a bad game code is not a legacy server', () => {
    expect(shouldFallThroughToDirectJoin(new Error('HTTP 404: Not Found'))).toBe(false);
  });

  it('rethrows network failures (no fall-through)', () => {
    expect(shouldFallThroughToDirectJoin(new TypeError('fetch failed'))).toBe(false);
  });

  it('rethrows infrastructure errors like HTTP 502 (no fall-through)', () => {
    expect(shouldFallThroughToDirectJoin(new Error('HTTP 502: Bad Gateway'))).toBe(false);
  });
});
