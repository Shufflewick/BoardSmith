import { describe, it, expect } from 'vitest';
import * as persistence from './index.js';

/**
 * The session-kind vocabulary (match | world, countsAsPlay) is a platform rule
 * that lives in ShufflewickPub's own Convex code. The engine never read it, so
 * `boardsmith/persistence` must not export it (#521).
 */
describe('boardsmith/persistence has no session-kind vocabulary (#521)', () => {
  it('exports none of the session-kind names', () => {
    const names = Object.keys(persistence);
    for (const gone of ['SESSION_KINDS', 'isSessionKind', 'resolveSessionKind', 'countsAsPlay']) {
      expect(names).not.toContain(gone);
    }
  });
});
