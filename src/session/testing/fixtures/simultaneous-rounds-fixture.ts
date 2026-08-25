/**
 * A MULTI-ROUND simultaneous fixture: the shape no other fixture in this
 * directory has, and the shape a real simultaneous game actually is.
 *
 * `simultaneous-fixture.ts` has ONE root `simultaneousActionStep` with no
 * enclosing loop, so it can never cross a round boundary — the step opens once
 * and closes once. This fixture LOOPS the step for `TOTAL_ROUNDS` rounds and
 * RESETS every seat's `committed` flag at the top of each round, which is the
 * only way to express the transition Phase 68 cares about:
 *
 *     round 1 open   → due seats [1, 2]
 *     round 1 closes → round 2 opens
 *     round 2 open   → due seats [1, 2]
 *
 * The due-seat SET is identical on both sides of a real boundary. That is why
 * no set comparison can detect one, and why `flowBoundaryKey` exists.
 *
 * ## Why `commit` deliberately carries NO `.condition(...)` guard
 *
 * `simultaneous-fixture.ts`'s `commit` is gated on
 * `'has not committed yet': (ctx) => !ctx.player.committed`. That guard belongs
 * to the GAME AUTHOR, and it is precisely what accidentally masks the engine's
 * missing protection: an hours-old resubmission bounces off the author's
 * condition rather than off anything the engine did. A fixture that inherits
 * that guard cannot express the defect, so this one does not have it. A seat is
 * kept out of a round it has already answered by `playerDone` — the ENGINE's
 * mechanism — and by nothing else.
 *
 * ## Consumers
 *  - **68-02** (`src/engine/flow/boundary-key.test.ts`) — cases 3 and 4, the
 *    mid-round-stands-still and round-boundary-moves halves of the key's
 *    contract.
 *  - **68-04** (stale submissions) — an hours-old `commit` naming a round that
 *    has since closed must be refused, and this is the only fixture in which
 *    such a submission is even constructible.
 *
 * Drive it with `createHeadlessSession(simultaneousRoundsFixtureDefinition, ...)`
 * or directly through `executeOp`.
 */

import {
  Game,
  Player,
  Action,
  defineFlow,
  simultaneousActionStep,
  sequence,
  execute,
  loop,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

/** How many full simultaneous rounds the flow plays before finishing. */
export const TOTAL_ROUNDS = 3;

/** A seat that commits once per round; the flag is cleared each round start. */
class RoundCommitPlayer extends Player<SimultaneousRoundsGame, RoundCommitPlayer> {
  committed = false;
}

class SimultaneousRoundsGame extends Game<SimultaneousRoundsGame, RoundCommitPlayer> {
  static PlayerClass = RoundCommitPlayer;

  /** 1-indexed round counter. A plain number, so it round-trips cleanly. */
  round = 1;

  constructor(options: GameOptions) {
    super(options);

    // NOTE: no `.condition(...)`. See the file header — the author's guard is
    // what hides the engine's missing round protection, so this fixture has
    // none. Completion is the engine's job, via `playerDone` below.
    this.registerAction(
      Action.create('commit').execute((_args, ctx) => {
        (ctx.player as RoundCommitPlayer).committed = true;
        return { success: true };
      }),
    );

    this.setFlow(
      defineFlow({
        root: sequence(
          loop({
            name: 'rounds',
            maxIterations: TOTAL_ROUNDS,
            while: () => this.round <= TOTAL_ROUNDS,
            do: sequence(
              // Round start: every seat owes a commit again. This reset is the
              // whole point of the fixture — it is what makes round N+1's due
              // seats identical to round N's.
              execute(() => {
                for (const player of this.players) {
                  player.committed = false;
                }
              }),
              simultaneousActionStep({
                name: 'commit-step',
                players: () => this.players,
                actions: ['commit'],
                playerDone: (_ctx, p) => (p as RoundCommitPlayer).committed,
              }),
              execute(() => {
                this.round += 1;
              }),
            ),
          }),
          execute(() => {
            this.finish();
          }),
        ),
      }),
    );
  }
}

export { SimultaneousRoundsGame, RoundCommitPlayer };

export const simultaneousRoundsFixtureDefinition: GameDefinitionLike = {
  gameClass: SimultaneousRoundsGame as new (...args: unknown[]) => unknown,
  gameType: 'simultaneous-rounds',
  minPlayers: 2,
  maxPlayers: 4,
};
