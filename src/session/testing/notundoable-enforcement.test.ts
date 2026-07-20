import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../headless-session.js';
import { GameSession } from '../game-session.js';
import { undoFenceFixtureDefinition, UndoFenceGame } from './fixtures/undo-fence-fixture.js';
import type { Op } from '../stateless-ops.js';

/**
 * UNDO-01 regression: `.notUndoable()` must be enforced SERVER-SIDE, not just
 * hidden by the client's advisory `canUndo` flag. Today `computeUndoInfo`
 * computes `hasNonUndoableAction` and both undo executors discard it
 * (`stateless-ops.ts`, `state-history.ts`) -- the server happily rewinds past
 * a non-undoable action anyway. Proven on BOTH executors (stateless
 * `SnapshotSessionHost` + stateful `GameSession`), per D-01/D-09.
 *
 * Negative control included per-executor: an ordinary undoable action in the
 * SAME fixture must still undo successfully -- the guard must not refuse
 * everything.
 */

const gameOptions = { playerCount: 2, seed: 't' };

describe('UNDO-01: notUndoable action blocks undo (stateless)', () => {
  it('refuses undo after a .notUndoable() action, naming the blocking action', async () => {
    const session = createHeadlessSession(undoFenceFixtureDefinition, gameOptions);
    await session.start();

    const lock = await session.send(1, { type: 'action', actionName: 'lock', player: 1, args: {} });
    expect(lock.success).toBe(true);

    const undo = await session.send(1, { type: 'undo', player: 1 } as Op);

    expect(undo.success).toBe(false);
    expect(undo.error).toMatch(/lock/i);
  });

  it('negative control: an ordinary undoable action still undoes successfully', async () => {
    const session = createHeadlessSession(undoFenceFixtureDefinition, gameOptions);
    await session.start();

    const play = await session.send(1, { type: 'action', actionName: 'play', player: 1, args: {} });
    expect(play.success).toBe(true);

    const undo = await session.send(1, { type: 'undo', player: 1 } as Op);

    expect(undo.success).toBe(true);
  });
});

describe('UNDO-01: notUndoable action blocks undo (stateful)', () => {
  it('refuses undo after a .notUndoable() action, naming the blocking action', async () => {
    const session = GameSession.create<UndoFenceGame>({
      gameType: 'undo-fence',
      GameClass: UndoFenceGame,
      playerCount: 2,
      playerNames: ['A', 'B'],
      seed: 't',
    });

    const lock = await session.performAction('lock', 1, {});
    expect(lock.success).toBe(true);

    const undo = await session.undoToTurnStart(1);

    expect(undo.success).toBe(false);
    expect(undo.error).toMatch(/lock/i);
  });

  it('negative control: an ordinary undoable action still undoes successfully', async () => {
    const session = GameSession.create<UndoFenceGame>({
      gameType: 'undo-fence',
      GameClass: UndoFenceGame,
      playerCount: 2,
      playerNames: ['A', 'B'],
      seed: 't',
    });

    const play = await session.performAction('play', 1, {});
    expect(play.success).toBe(true);

    const undo = await session.undoToTurnStart(1);

    expect(undo.success).toBe(true);
  });
});
