import { describe, it, expect } from 'vitest';
import { CommitGame } from '../../session/testing/fixtures/simultaneous-fixture.js';

/**
 * SIM-03 / D21 regression: once every awaiting seat has individually
 * completed (via `playerDone`) but the step-wide `allDone` gate is still
 * unsatisfied, the awaiting set is "empty" from the perspective of who can
 * still act -- yet `resumeSimultaneousAction` (`engine.ts:501-607`) leaves
 * the frame `awaitingInput: true` with no eligible actor. The NEXT resume
 * that doesn't supply an explicit `playerIndex` (`game.continueFlow(name,
 * args)`, the same 2-arg form the public API documents as valid) falls
 * through to `firstAwaiting = this.awaitingPlayers.find(p => !p.completed
 * && ...)`, finds nothing, and throws "No player specified and no awaiting
 * players found" (`engine.ts:519-520`) instead of recognizing the step has
 * nothing left to wait for and completing cleanly.
 *
 * Uses the shared `simultaneous-fixture.ts` (`CommitGame`, 2 seats):
 * `allDone` is gated on `roundClosed`, independent of the seats' own
 * `committed`/`playerDone` state, so the "all seats individually done, but
 * allDone still false" edge is directly reachable.
 */
describe('SIM-03 / D21: allDone-on-empty awaitingPlayers', () => {
  it('a resume with no eligible actor (all seats completed, allDone false) completes cleanly instead of throwing', () => {
    const game = new CommitGame({ playerCount: 2, seed: 't' });
    game.startFlow();

    // Both seats commit -- each individually completed via playerDone --
    // but roundClosed (allDone) is still false, so the step never actually
    // finalizes on either commit call.
    const first = game.continueFlow('commit', {}, 1);
    expect(first.awaitingInput).toBe(true);
    const second = game.continueFlow('commit', {}, 2);
    expect(second.awaitingInput).toBe(true);
    expect(second.awaitingPlayers?.every((p) => p.completed)).toBe(true);

    // A subsequent resume with no explicit seat (the documented 2-arg form
    // of continueFlow) has no eligible actor to fall back to. Pre-fix this
    // throws; post-fix it must recognize nothing is left to await and
    // complete the step cleanly.
    const result = game.continueFlow('commit', {});

    expect(result.awaitingInput).toBe(false);
    expect(result.complete).toBe(true);
  });

  it('sanity: a fresh step entered with nothing to await (allDone already true) completes without ever needing a resume', () => {
    const game = new CommitGame({ playerCount: 2, seed: 't' });
    // Both seats are already "done" before the step is even entered, and
    // the round-closing gate is already open.
    for (const player of game.players) {
      (player as unknown as { committed: boolean }).committed = true;
    }
    game.roundClosed = true;

    const state = game.startFlow();

    expect(state.awaitingInput).toBe(false);
    expect(state.complete).toBe(true);
  });
});
