/**
 * Minimal fixture that faithfully mirrors MERC's "Day 1 landing" turn opening.
 *
 * Faithfulness that matters for the regression:
 *  - `placeLanding` and `hireFirstMerc` are BOTH offered by the SAME
 *    `simultaneousActionStep` (MERC's `rebel-landing-actions`), wrapped in a
 *    `loop`. They are NOT two sequential `actionStep`s.
 *  - Which of the two is "available" is decided per-player by each action's
 *    `condition` (placeLanding requires not-yet-landed; hireFirstMerc requires
 *    landed-but-not-hired). After `placeLanding` executes, the simultaneous step
 *    must RE-EVALUATE the player's available actions to `[hireFirstMerc]`.
 *  - `placeLanding` carries a required element selection (`sector`), so the
 *    client sends it as a normal `action placeLanding {sector:<id>}` op.
 *
 * The regression: across the executeOp -> getSnapshot -> fromSnapshot round-trip,
 * the post-`placeLanding` available actions must advance to `[hireFirstMerc]`,
 * not stay stuck on `[placeLanding]`.
 */

import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  simultaneousActionStep,
  sequence,
  execute,
  loop,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

/** A landing-zone sector the player picks during placeLanding. */
class Sector extends Space<SequenceGame> {}

/** A mercenary piece created by hireFirstMerc. */
class Merc extends Piece<SequenceGame> {}

/** A rebel player who must land, then hire. */
class RebelPlayer extends Player<SequenceGame, RebelPlayer> {
  landed = false;
  hired = false;
}

class SequenceGame extends Game<SequenceGame, RebelPlayer> {
  static PlayerClass = RebelPlayer;

  board!: Space;

  constructor(options: GameOptions) {
    super(options);

    this.board = this.create(Space, 'board');
    this.board.create(Sector, 'sector-A');
    this.board.create(Sector, 'sector-B');
    this.board.create(Sector, 'sector-C');

    // placeLanding: gated to "not yet landed". Required element selection.
    this.registerAction(
      Action.create('placeLanding')
        .condition({
          'has not landed yet': (ctx) => !(ctx.player as RebelPlayer).landed,
        })
        .chooseElement('sector', {
          elementClass: Sector,
          filter: (el) => el.parent === this.board,
        })
        .execute((_args, ctx) => {
          (ctx.player as RebelPlayer).landed = true;
          return { success: true };
        }),
    );

    // hireFirstMerc: gated to "landed but not hired". No selection.
    this.registerAction(
      Action.create('hireFirstMerc')
        .condition({
          'landed but not hired': (ctx) => {
            const p = ctx.player as RebelPlayer;
            return p.landed && !p.hired;
          },
        })
        .execute((_args, ctx) => {
          (ctx.player as RebelPlayer).hired = true;
          this.create(Merc, 'merc-1');
          return { success: true };
        }),
    );

    // IMPORTANT: the awaiting `simultaneousActionStep` sits inside a `loop` that
    // is a NON-LAST child of the root `sequence` (steps[1] of 3). This mirrors
    // MERC, whose landing phase is a non-last child of the root sequence — the
    // shape that exercises the flow-position restore() off-by-one. (A flow whose
    // awaiting node is the LAST child of every enclosing sequence accidentally
    // round-trips fine and would NOT reproduce the bug.)
    this.setFlow(
      defineFlow({
        root: sequence(
          // step 0: a setup execute (so the loop is not steps[0]).
          execute(() => {
            this.message('setup');
          }),
          // step 1 (NON-LAST): the landing loop.
          loop({
            name: 'rebel-landing',
            while: () => this.players.some((p) => !(p.landed && p.hired)),
            maxIterations: 50,
            do: simultaneousActionStep({
              name: 'rebel-landing-actions',
              players: () => this.players,
              actions: ['placeLanding', 'hireFirstMerc'],
              playerDone: (_ctx, p) => (p as RebelPlayer).landed && (p as RebelPlayer).hired,
              skipPlayer: (_ctx, p) => (p as RebelPlayer).landed && (p as RebelPlayer).hired,
            }),
          }),
          // step 2: a trailing execute so the loop is a non-last sibling.
          execute(() => {
            this.message('cleanup');
          }),
        ),
      }),
    );
  }
}

export { SequenceGame, RebelPlayer, Sector, Merc };

export const sequenceFixtureDefinition: GameDefinitionLike = {
  gameClass: SequenceGame as new (...args: unknown[]) => unknown,
  gameType: 'sequence',
  minPlayers: 1,
  maxPlayers: 4,
};
