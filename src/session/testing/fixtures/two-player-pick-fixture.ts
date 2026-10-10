/**
 * Two players take turns picking one of three options, forever (up to 20
 * rounds). Three choices, so a bot's search does not short-circuit to the
 * single-move path; endless turns, so a test can always find a decision point.
 */
import { Game, Player, Action, loop, eachPlayer, actionStep, type GameOptions } from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

export class TwoPlayerPickGame extends Game<TwoPlayerPickGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('pick')
        .chooseFrom('option', {
          prompt: 'Pick an option',
          choices: ['a', 'b', 'c'],
        })
        .execute(() => {}),
    );

    this.setFlow({
      root: loop({
        maxIterations: 20,
        do: eachPlayer({
          do: actionStep({ actions: ['pick'] }),
        }),
      }),
    });
  }
}

export const twoPlayerPickDefinition: GameDefinitionLike = {
  gameClass: TwoPlayerPickGame,
  gameType: 'two-player-pick',
  minPlayers: 2,
  maxPlayers: 2,
};
