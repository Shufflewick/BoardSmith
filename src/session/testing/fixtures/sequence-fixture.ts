/**
 * Minimal fixture that mirrors a two-step turn opening: make camp, then recruit.
 *
 * Faithfulness that matters for the regression:
 *  - `chooseCamp` and `recruitFirstHero` are BOTH offered by the SAME
 *    `simultaneousActionStep`, wrapped in a
 *    `loop`. They are NOT two sequential `actionStep`s.
 *  - Which of the two is "available" is decided per-player by each action's
 *    `condition` (chooseCamp requires not-yet-camped; recruitFirstHero requires
 *    camped-but-not-recruited). After `chooseCamp` executes, the simultaneous step
 *    must RE-EVALUATE the player's available actions to `[recruitFirstHero]`.
 *  - `chooseCamp` carries a required element selection (`site`), so the
 *    client sends it as a normal `action chooseCamp {site:<id>}` op.
 *
 * The regression: across the executeOp -> getSnapshot -> fromSnapshot round-trip,
 * the post-`chooseCamp` available actions must advance to `[recruitFirstHero]`,
 * not stay stuck on `[chooseCamp]`.
 */

import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  simultaneousActionStep,
  sequence,
  execute,
  loop,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

/** A campsite the player picks during chooseCamp. */
class Site extends Space<SequenceGame> {}

/** A hero piece created by recruitFirstHero. */
class Hero extends Piece<SequenceGame> {}

/** An explorer who must make camp, then recruit. */
class ExplorerPlayer extends Player<SequenceGame, ExplorerPlayer> {
  camped = false;
  recruited = false;
}

class SequenceGame extends Game<SequenceGame, ExplorerPlayer> {
  static PlayerClass = ExplorerPlayer;

  board!: Space;

  constructor(options: GameOptions) {
    super(options);

    // `Hero` is created mid-flow (recruitFirstHero), not in this constructor, so
    // it would otherwise never reach a restored game's class registry and the
    // fixture's snapshot would be unrestorable once a hero exists.
    this.registerElements([Hero]);

    this.board = this.create(Space, 'board');
    this.board.create(Site, 'site-A');
    this.board.create(Site, 'site-B');
    this.board.create(Site, 'site-C');

    // chooseCamp: gated to "not yet camped". Required element selection.
    this.registerAction(
      Action.create('chooseCamp')
        .condition({
          'has not camped yet': (ctx) => !(ctx.player as ExplorerPlayer).camped,
        })
        .chooseElement('site', {
          elementClass: Site,
          filter: (el) => el.parent === this.board,
        })
        .execute((_args, ctx) => {
          (ctx.player as ExplorerPlayer).camped = true;
          return { success: true };
        }),
    );

    // recruitFirstHero: gated to "camped but not recruited". No selection.
    this.registerAction(
      Action.create('recruitFirstHero')
        .condition({
          'camped but not recruited': (ctx) => {
            const p = ctx.player as ExplorerPlayer;
            return p.camped && !p.recruited;
          },
        })
        .execute((_args, ctx) => {
          (ctx.player as ExplorerPlayer).recruited = true;
          this.create(Hero, 'hero-1');
          return { success: true };
        }),
    );

    // IMPORTANT: the awaiting `simultaneousActionStep` sits inside a `loop` that
    // is a NON-LAST child of the root `sequence` (steps[1] of 3). This is the
    // shape that exercises the flow-position restore() off-by-one. (A flow whose
    // awaiting node is the LAST child of every enclosing sequence accidentally
    // round-trips fine and would NOT reproduce the bug.)
    this.setFlow({
      root: sequence(
        // step 0: a setup execute (so the loop is not steps[0]).
        execute(() => {
          this.message('setup');
        }),
        // step 1 (NON-LAST): the camp loop.
        loop({
          name: 'camp-setup',
          while: () => this.players.some((p) => !(p.camped && p.recruited)),
          maxIterations: 50,
          do: simultaneousActionStep({
            name: 'camp-setup-actions',
            players: () => this.players,
            actions: ['chooseCamp', 'recruitFirstHero'],
            playerDone: (_ctx, p) => (p as ExplorerPlayer).camped && (p as ExplorerPlayer).recruited,
            skipPlayer: (_ctx, p) => (p as ExplorerPlayer).camped && (p as ExplorerPlayer).recruited,
          }),
        }),
        // step 2: a trailing execute so the loop is a non-last sibling.
        execute(() => {
          this.message('cleanup');
        }),
      ),
    });
  }
}

export { SequenceGame, ExplorerPlayer, Site, Hero };

export const sequenceFixtureDefinition: GameDefinitionLike = {
  gameClass: SequenceGame,
  gameType: 'sequence',
  minPlayers: 1,
  maxPlayers: 4,
};
