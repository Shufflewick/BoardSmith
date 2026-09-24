import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from './headless-session.js';
import {
  fixedDeployDefinition,
  growingDeployDefinition,
  untimedDeployDefinition,
} from './testing/fixtures/timed-step-fixture.js';

/**
 * The turn boundary a host broadcasts carries the window the open step declared
 * (#300), as a duration. The host arms its own clock from it; the engine keeps
 * none.
 */

const opts = { playerCount: 2, seed: 'step-time-limit-boundary' };

describe('turnBoundary.timeLimitMs', () => {
  it('is present on the broadcast that opens a timed step', async () => {
    const session = createHeadlessSession(fixedDeployDefinition, opts);
    await session.start();

    expect(session.metas.at(-1)!.turnBoundary.timeLimitMs).toBe(120_000);
  });

  it('is absent on a step without a limit', async () => {
    const session = createHeadlessSession(untimedDeployDefinition, opts);
    await session.start();

    expect(session.metas.at(-1)!.turnBoundary).not.toHaveProperty('timeLimitMs');
  });

  it('stays the window the round opened with while seats submit, and moves with the round', async () => {
    const session = createHeadlessSession(growingDeployDefinition, opts);
    await session.start();
    const opening = session.metas.at(-1)!.turnBoundary;
    expect(opening.timeLimitMs).toBe(30_000);

    await session.send(1, { type: 'action', actionName: 'commit', player: 1, args: {} });
    const midRound = session.metas.at(-1)!.turnBoundary;
    expect(midRound.key).toBe(opening.key);
    expect(midRound.timeLimitMs).toBe(30_000);

    await session.send(2, { type: 'action', actionName: 'commit', player: 2, args: {} });
    const nextRound = session.metas.at(-1)!.turnBoundary;
    expect(nextRound.key).not.toBe(opening.key);
    expect(nextRound.timeLimitMs).toBe(32_000);
  });

  it('does not change the boundary key: a timed and an untimed step at the same position share it', async () => {
    const timed = createHeadlessSession(fixedDeployDefinition, opts);
    const untimed = createHeadlessSession(untimedDeployDefinition, opts);
    await timed.start();
    await untimed.start();

    expect(timed.metas.at(-1)!.turnBoundary.key).toBe(untimed.metas.at(-1)!.turnBoundary.key);
  });
});
