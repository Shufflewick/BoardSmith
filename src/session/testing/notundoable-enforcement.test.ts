import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../headless-session.js';
import { undoFenceFixtureDefinition } from './fixtures/undo-fence-fixture.js';
import type { Op } from '../stateless-ops.js';

/**
 * UNDO-01 regression: `.notUndoable()` must be enforced SERVER-SIDE, not just
 * hidden by the client's advisory `canUndo` flag. `computeUndoInfo` computes
 * `hasNonUndoableAction`, and the undo op (`stateless-ops.ts`) must refuse
 * on it rather than rewind past a non-undoable action. Driven through the
 * `SnapshotSessionHost` every host uses.
 *
 * Negative control: an ordinary undoable action in the SAME fixture must
 * still undo successfully -- the guard must not refuse everything.
 */

const gameOptions = { playerCount: 2, seed: 't' };

describe('UNDO-01: notUndoable action blocks undo', () => {
  it('refuses undo after a .notUndoable() action, naming the blocking action', async () => {
    const session = createHeadlessSession(undoFenceFixtureDefinition, gameOptions);
    await session.start();

    const lock = await session.send(1, { type: 'action', actionName: 'lock', player: 1, args: {} });
    expect(lock.success).toBe(true);

    const undo = await session.send(1, { type: 'undo', player: 1 });

    expect(undo.success).toBe(false);
    expect(undo.error).toMatch(/lock/i);
  });

  it('negative control: an ordinary undoable action still undoes successfully', async () => {
    const session = createHeadlessSession(undoFenceFixtureDefinition, gameOptions);
    await session.start();

    const play = await session.send(1, { type: 'action', actionName: 'play', player: 1, args: {} });
    expect(play.success).toBe(true);

    const undo = await session.send(1, { type: 'undo', player: 1 });

    expect(undo.success).toBe(true);
  });
});
