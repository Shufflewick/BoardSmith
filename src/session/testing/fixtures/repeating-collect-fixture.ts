/**
 * A repeating selection whose `onEach` MOVES pieces while the selection is
 * still open.
 *
 * Those moves are recorded in neither the command nor the action history, so
 * they are the case restore has to get right: they exist only in the snapshot,
 * and the picks that caused them exist only in the seat's pending state until
 * the selection ends with 'stop'. Used by the authoritative restore tests
 * (F42) and the SnapshotSessionHost pending-selection restore tests (#320).
 *
 * Player 1 keeps the turn (`repeatUntil: () => false`), so undo stays
 * available after a completed collect. `execute` records the `token` argument
 * it received in `collected`, and `onEach` records every pick it was called
 * with in `eachCalls`, so a test can compare what each path that submits a
 * move ran (#325).
 */
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

export class Token extends Piece<RepeatingCollectGame> {}
class Stash extends Space<RepeatingCollectGame> {}
class Hand extends Space<RepeatingCollectGame> {}

export class RepeatingCollectGame extends Game<RepeatingCollectGame, Player> {
  stash!: Stash;
  hand!: Hand;
  /** The `token` argument the last completed `collect` was handed, as given. */
  collected: unknown = null;
  /** Every value `onEach` was called with, in order, across the whole game. */
  eachCalls: string[] = [];

  constructor(options: GameOptions) {
    super(options);

    this.stash = this.create(Stash, 'stash');
    this.hand = this.create(Hand, 'hand');
    this.stash.create(Token, 'p1');
    this.stash.create(Token, 'p2');
    this.stash.create(Token, 'p3');

    this.registerAction(
      Action.create('collect')
        .chooseFrom('token', {
          // The remaining stash token names plus the 'stop' terminator.
          choices: (ctx) => [
            ...(ctx.game as RepeatingCollectGame).stash.all(Token).map((t) => t.name!),
            'stop',
          ],
          repeat: {
            until: (_ctx, last) => last === 'stop',
            onEach: (ctx, choice) => {
              const game = ctx.game as RepeatingCollectGame;
              game.eachCalls.push(choice);
              if (choice === 'stop') return;
              game.stash.all(Token).find((t) => t.name === choice)?.putInto(game.hand);
            },
          },
        })
        .execute((args, ctx) => {
          (ctx.game as RepeatingCollectGame).collected = args.token;
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['collect'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 10,
        }),
      }),
    );
  }
}

export const repeatingCollectDefinition: GameDefinitionLike = {
  gameClass: RepeatingCollectGame,
  gameType: 'collect',
  minPlayers: 1,
  maxPlayers: 2,
};
