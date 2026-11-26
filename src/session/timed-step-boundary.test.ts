import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../testing/headless-session.js';
import { fixedDeployDefinition, untimedDeployDefinition } from './testing/fixtures/timed-step-fixture.js';

/**
 * The turn boundary a host broadcasts says whether the open step is timed
 * (#300, #1830). The host times it with the table's time per turn, on its own
 * clock; the engine keeps none.
 */

const opts = { playerCount: 2, seed: 'timed-step-boundary' };

describe('turnBoundary.timed', () => {
  it('is present on the broadcast that opens a timed step, and while seats submit', async () => {
    const session = createHeadlessSession(fixedDeployDefinition, opts);
    await session.start();
    expect(session.metas.at(-1)!.turnBoundary.timed).toBe(true);

    await session.send(1, { type: 'action', actionName: 'commit', player: 1, args: {} });
    expect(session.metas.at(-1)!.turnBoundary.timed).toBe(true);
  });

  it('is absent on a step that is not timed', async () => {
    const session = createHeadlessSession(untimedDeployDefinition, opts);
    await session.start();

    expect(session.metas.at(-1)!.turnBoundary).not.toHaveProperty('timed');
  });

  it('does not change the boundary key: a timed and an untimed step at the same position share it', async () => {
    const timed = createHeadlessSession(fixedDeployDefinition, opts);
    const untimed = createHeadlessSession(untimedDeployDefinition, opts);
    await timed.start();
    await untimed.start();

    expect(timed.metas.at(-1)!.turnBoundary.key).toBe(untimed.metas.at(-1)!.turnBoundary.key);
  });
});
