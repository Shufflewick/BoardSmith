import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from './headless-harness.js';
import { eachPlayerFixtureDefinition } from './fixtures/each-player-fixture.js';

/**
 * `eachPlayer` binds the current Player as a LIVE element into
 * `flowState.position.variables`. The headless harness structured-clones every
 * broadcast (mirroring the production postMessage / executor-RPC boundary), so a
 * live element there throws DataCloneError. These tests prove the flow state is
 * serialized on the way out and relinked on the way in.
 */

const gameOptions = { playerCount: 2, seed: 't' };

function currentPlayer(result: { flowState: unknown }): number | undefined {
  return (result.flowState as { currentPlayer?: number } | undefined)?.currentPlayer;
}

describe('eachPlayer flow-state crosses the structured-clone boundary', () => {
  it('starts and rotates players without a DataCloneError', async () => {
    const session = createHeadlessSession(eachPlayerFixtureDefinition, gameOptions);

    // start() broadcasts player views; a live Player flow variable would throw here.
    await session.start();

    // Snapshot round-trips through executeOp on every action; eachPlayer must keep
    // advancing the current player across the boundary.
    const p1 = await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} });
    expect(p1.success).toBe(true);
    expect(currentPlayer(p1)).toBe(2);

    const p2 = await session.send(2, { type: 'action', actionName: 'pass', player: 2, args: {} });
    expect(p2.success).toBe(true);
    expect(currentPlayer(p2)).toBe(1); // looped back to player 1
  });

  it('serializes element-valued flow variables in the snapshot (no live class instances)', async () => {
    const session = createHeadlessSession(eachPlayerFixtureDefinition, gameOptions);
    await session.start();
    const res = await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} });

    // The snapshot must be structured-cloneable end to end (executor RPC / DO storage).
    expect(() => structuredClone(res.snapshot)).not.toThrow();
  });
});
