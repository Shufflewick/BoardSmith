import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../headless-session.js';
import { GameSession } from '../game-session.js';
import { undoFenceFixtureDefinition, UndoFenceGame } from './fixtures/undo-fence-fixture.js';
import type { Op } from '../stateless-ops.js';

/**
 * UNDO-02 (finished-phase half): undo must be refused OUTRIGHT once
 * `game.phase === 'finished'`, rather than silently rolling the phase back
 * via the pre-finish checkpoint. Today neither executor checks phase before
 * restoring, so an undo after `game.finish()` silently un-finishes the game.
 * Proven on BOTH executors, per D-01/D-09/D-04.
 */

const gameOptions = { playerCount: 2, seed: 't' };

describe('UNDO-02: undo refused once the game is finished (stateless)', () => {
  it('refuses undo after game.phase becomes "finished", naming the reason', async () => {
    const session = createHeadlessSession(undoFenceFixtureDefinition, gameOptions);
    await session.start();

    const end = await session.send(1, { type: 'action', actionName: 'endGame', player: 1, args: {} });
    expect(end.success).toBe(true);
    expect((end.snapshot as { state?: { attributes?: { phase?: string } } } | null)?.state?.attributes?.phase).toBe(
      'finished',
    );

    const undo = await session.send(1, { type: 'undo', player: 1 } as Op);

    expect(undo.success).toBe(false);
    expect(undo.error).toMatch(/finish/i);
  });
});

describe('UNDO-02: undo refused once the game is finished (stateful)', () => {
  it('refuses undo after game.phase becomes "finished", naming the reason', async () => {
    const session = GameSession.create<UndoFenceGame>({
      gameType: 'undo-fence',
      GameClass: UndoFenceGame,
      playerCount: 2,
      playerNames: ['A', 'B'],
      seed: 't',
    });

    const end = await session.performAction('endGame', 1, {});
    expect(end.success).toBe(true);
    expect(session.runner.game.isFinished()).toBe(true);

    const undo = await session.undoToTurnStart(1);

    expect(undo.success).toBe(false);
    expect(undo.error).toMatch(/finish/i);
  });
});
