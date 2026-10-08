import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../headless-session.js';
import { undoFenceFixtureDefinition } from './fixtures/undo-fence-fixture.js';
import type { Op } from '../stateless-ops.js';
import { succeeded } from '../op-result.test-helper.js';

/**
 * UNDO-02 (finished-phase half): undo must be refused OUTRIGHT once
 * `game.phase === 'finished'`, rather than silently rolling the phase back
 * via the pre-finish checkpoint. Without the phase check before restoring,
 * an undo after `game.finish()` would silently un-finish the game.
 */

const gameOptions = { playerCount: 2, seed: 't' };

describe('UNDO-02: undo refused once the game is finished', () => {
  it('refuses undo after game.phase becomes "finished", naming the reason', async () => {
    const session = createHeadlessSession(undoFenceFixtureDefinition, gameOptions);
    await session.start();

    const end = succeeded(await session.send(1, { type: 'action', actionName: 'endGame', player: 1, args: {} }));
    expect(end.success).toBe(true);
    // `phase` is a TOP-LEVEL field of the serialized state, not an entry in the
    // generic attribute bag — see GAME_TOP_LEVEL_FIELDS in engine/element/game.ts.
    expect((end.snapshot as { state?: { phase?: string } } | null)?.state?.phase).toBe('finished');

    const undo = await session.send(1, { type: 'undo', player: 1 });

    expect(undo.success).toBe(false);
    expect(undo.error).toMatch(/finish/i);
  });
});
