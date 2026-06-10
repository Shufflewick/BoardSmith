import { describe, it, expect } from 'vitest';
import { executeOp } from '../stateless-ops.js';
import { sequenceFixtureDefinition } from './fixtures/sequence-fixture.js';

/**
 * Regression: MERC's Day-1 landing offers `placeLanding` and `hireFirstMerc`
 * from the SAME simultaneousActionStep (gated by conditions). After
 * `placeLanding` (an action with a required selection) succeeds, the player's
 * available actions must RE-EVALUATE to `[hireFirstMerc]` across the
 * snapshot round-trip — not stay stuck on `[placeLanding]`.
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
  it('placeLanding advances to hireFirstMerc', async () => {
    // start
    const started = await executeOp(sequenceFixtureDefinition, gameOptions, null, null, { type: 'start' });
    expect(started.success).toBe(true);
    expect(actionsFor(started.flowState as FS, 1)).toEqual(['placeLanding']);

    // discover a valid sector id
    const choices = await executeOp(sequenceFixtureDefinition, gameOptions, started.snapshot, null, {
      type: 'resolveChoices',
      actionName: 'placeLanding',
      player: 1,
      selectionName: 'sector',
      args: {},
    });
    expect(choices.success).toBe(true);
    const valid = (choices.validElements as Array<{ id: number }>) ?? [];
    expect(valid.length).toBeGreaterThan(0);
    const sectorId = valid[0].id;

    // perform placeLanding with the selection
    const acted = await executeOp(sequenceFixtureDefinition, gameOptions, started.snapshot, null, {
      type: 'action',
      actionName: 'placeLanding',
      player: 1,
      args: { sector: sectorId },
    });
    expect(acted.success).toBe(true);

    // in-process post-action flow state must have advanced
    expect(actionsFor(acted.flowState as FS, 1)).toEqual(['hireFirstMerc']);

    // the broadcast/playerViews must agree (this is what the client renders)
    const view = (acted.playerViews as Array<{ state: { availableActions: string[] } }>)[0];
    expect(view.state.availableActions).toEqual(['hireFirstMerc']);

    // ROUND-TRIP: load the post-action snapshot fresh and re-derive the flow.
    // The buggy client auto-fires `placeLanding {}`; the server must REJECT it
    // because placeLanding is no longer available after the round-trip.
    const replayEmpty = await executeOp(sequenceFixtureDefinition, gameOptions, acted.snapshot, null, {
      type: 'action',
      actionName: 'placeLanding',
      player: 1,
      args: {},
    });
    expect(replayEmpty.success).toBe(false);

    // And hireFirstMerc must be the available action after the round-trip.
    const after = await executeOp(sequenceFixtureDefinition, gameOptions, acted.snapshot, null, {
      type: 'action',
      actionName: 'hireFirstMerc',
      player: 1,
      args: {},
    });
    expect(after.success).toBe(true);
  });
});
