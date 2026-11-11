import { describe, it, expect } from 'vitest';
import { executeOp } from '../stateless-ops.js';
import { boundaryKeyOf } from './boundary-stamp.js';
import { ErrorCode } from '../../types/protocol.js';
import { sequenceFixtureDefinition } from './fixtures/sequence-fixture.js';
import { succeeded } from '../op-result.test-helper.js';

/**
 * Regression: a turn opening that offers `chooseCamp` and `recruitFirstHero`
 * from the SAME simultaneousActionStep (gated by conditions). After
 * `chooseCamp` (an action with a required selection) succeeds, the player's
 * available actions must RE-EVALUATE to `[recruitFirstHero]` across the
 * snapshot round-trip — not stay stuck on `[chooseCamp]`.
 */

const gameOptions = { playerCount: 1, seed: 't' };

type FS =
  | {
      awaitingPlayers?: Array<{ playerIndex: number; availableActions: string[]; completed: boolean }>;
      availableActions?: string[];
    }
  | undefined;

function actionsFor(flowState: FS, seat: number): string[] | undefined {
  if (!flowState) return undefined;
  if (flowState.awaitingPlayers && flowState.awaitingPlayers.length > 0) {
    return flowState.awaitingPlayers.find((p) => p.playerIndex === seat)?.availableActions;
  }
  return flowState.availableActions;
}

describe('simultaneous-step action advancement survives snapshot round-trip', () => {
  it('chooseCamp advances to recruitFirstHero', async () => {
    // start
    const started = succeeded(await executeOp(sequenceFixtureDefinition, gameOptions, null, null, { type: 'start' }));
    expect(started.success).toBe(true);
    expect(actionsFor(started.snapshot.flowState as FS, 1)).toEqual(['chooseCamp']);

    // discover a valid site id
    const choices = succeeded(await executeOp(sequenceFixtureDefinition, gameOptions, started.snapshot, null, {
      type: 'resolveChoices',
      actionName: 'chooseCamp',
      player: 1,
      selectionName: 'site',
      args: {},
    }));
    expect(choices.success).toBe(true);
    const valid = (choices.validElements as Array<{ id: number }>) ?? [];
    expect(valid.length).toBeGreaterThan(0);
    const siteId = valid[0].id;

    // perform chooseCamp with the selection
    const acted = succeeded(await executeOp(sequenceFixtureDefinition, gameOptions, started.snapshot, null, {
      type: 'action',
      actionName: 'chooseCamp',
      player: 1,
      args: { site: siteId },
      boundaryKey: boundaryKeyOf(started.snapshot),
    }));
    expect(acted.success).toBe(true);

    // in-process post-action flow state must have advanced
    expect(actionsFor(acted.snapshot.flowState as FS, 1)).toEqual(['recruitFirstHero']);

    // the broadcast/playerViews must agree (this is what the client renders)
    const view = (acted.playerViews as Array<{ state: { availableActions: string[] } }>)[0];
    expect(view.state.availableActions).toEqual(['recruitFirstHero']);

    // ROUND-TRIP: load the post-action snapshot fresh and re-derive the flow.
    // The buggy client auto-fires `chooseCamp {}`; the server must REJECT it
    // because chooseCamp is no longer available after the round-trip.
    const replayEmpty = await executeOp(sequenceFixtureDefinition, gameOptions, acted.snapshot, null, {
      type: 'action',
      actionName: 'chooseCamp',
      player: 1,
      args: {},
      // The CURRENT key: this replay must still be refused for the reason the
      // test is about (chooseCamp is no longer available), not for staleness.
      boundaryKey: boundaryKeyOf(acted.snapshot),
    });
    expect(replayEmpty.success).toBe(false);
    expect(replayEmpty.errorCode).not.toBe(ErrorCode.STALE_SUBMISSION);

    // And recruitFirstHero must be the available action after the round-trip.
    const after = await executeOp(sequenceFixtureDefinition, gameOptions, acted.snapshot, null, {
      type: 'action',
      actionName: 'recruitFirstHero',
      player: 1,
      args: {},
      boundaryKey: boundaryKeyOf(acted.snapshot),
    });
    expect(after.success).toBe(true);
  });
});
