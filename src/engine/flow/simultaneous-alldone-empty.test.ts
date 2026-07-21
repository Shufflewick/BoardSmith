import { describe, it, expect } from 'vitest';
import { CommitGame } from '../../session/testing/fixtures/simultaneous-fixture.js';
import { Game, Player, Action, FlowEngine, defineFlow, simultaneousActionStep } from '../index.js';

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

/**
 * Task 3 adversarial: reach the same "no eligible actor, allDone
 * unsatisfied" edge via a DIFFERENT route than the primary regression --
 * the engine's own "no available actions left" auto-complete branch
 * (`engine.ts` resumeSimultaneousAction, re-eval block) rather than an
 * explicit `playerDone` callback -- to prove the fix isn't narrowly
 * targeted at the primary reproduction.
 */
describe('SIM-03 / D21 adversarial: variant route via auto-completed availableActions', () => {
  class VariantPlayer extends Player<VariantGame, VariantPlayer> {
    committed = false;
  }

  class VariantGame extends Game<VariantGame, VariantPlayer> {
    static PlayerClass = VariantPlayer;
    roundClosed = false;
  }

  it('all seats auto-completed via re-evaluated availableActions (no playerDone) still completes cleanly, not just the primary reproduction', () => {
    const game = new VariantGame({ playerCount: 2, seed: 't' });

    game.registerAction(
      Action.create('commit')
        .condition({
          'has not committed yet': (ctx) => !(ctx.player as VariantPlayer).committed,
        })
        .execute((_args, ctx) => {
          (ctx.player as VariantPlayer).committed = true;
          return { success: true };
        }),
    );

    const flow = defineFlow({
      root: simultaneousActionStep({
        actions: ['commit'],
        // Deliberately NO playerDone -- completion for each seat comes
        // solely from the "no available actions left after re-eval" branch
        // (engine.ts resumeSimultaneousAction, not the playerDone branch).
        allDone: () => game.roundClosed,
      }),
    });

    const engine = new FlowEngine(game, flow);
    const start = engine.start();
    expect(start.awaitingPlayers).toHaveLength(2);

    const afterSeat1 = engine.resume('commit', {}, 1);
    expect(afterSeat1.awaitingInput).toBe(true);
    const afterSeat2 = engine.resume('commit', {}, 2);
    expect(afterSeat2.awaitingInput).toBe(true);
    // Both seats auto-completed (their available actions re-evaluated to
    // empty once committed), yet allDone (roundClosed) is still false.
    expect(afterSeat2.awaitingPlayers?.every((p) => p.completed)).toBe(true);

    // A stray resume with no eligible actor must complete cleanly, not
    // throw -- via the auto-complete route this time.
    const result = engine.resume('commit', {});
    expect(result.awaitingInput).toBe(false);
    expect(result.complete).toBe(true);
  });
});
