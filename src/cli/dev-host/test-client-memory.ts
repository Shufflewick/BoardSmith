/**
 * What a dev-host test client last RENDERED, remembered the way a browser
 * remembers the last `game_state` frame it drew.
 *
 * A test that drives `MultiplayerHost` is standing in for a browser, and a
 * browser echoes the boundary key of the state it is looking at. Reading the
 * key off the host instead would make such a harness stop being a client: it
 * would always be current, and could never compose a stale submission — which
 * is exactly the case `src/session/testing/stale-submission.test.ts` exists to
 * hold. See `docs/simultaneous-and-interrupt-semantics.md`.
 *
 * The memory lives OUTSIDE the per-test `sent` log on purpose: tests call
 * `clear()` to scope their assertions, and a client does not forget the board
 * it is looking at because a test reset an assertion buffer.
 *
 * Each test file gets its own instance (Vitest isolates modules per file), and
 * a suite should still `beforeEach(() => memory.reset())` so a key cannot leak
 * from one game into the next.
 */

import { boundaryKeyOf } from '../../session/testing/boundary-stamp.js';

interface DevHostClientMemory {
  /** Feed every outbound host message through this; only `game_state` is kept. */
  remember(clientId: string, msg: { type: string; view?: unknown }): void;
  /** The boundary key `clientId` would echo on its next submission. */
  key(clientId: string): string;
  /** Forget every client's rendered state (call from `beforeEach`). */
  reset(): void;
}

export function createDevHostClientMemory(): DevHostClientMemory {
  const lastRendered = new Map<string, unknown>();
  return {
    remember(clientId, msg) {
      if (msg.type === 'game_state') lastRendered.set(clientId, msg.view);
    },
    key(clientId) {
      return boundaryKeyOf(lastRendered.get(clientId));
    },
    reset() {
      lastRendered.clear();
    },
  };
}
