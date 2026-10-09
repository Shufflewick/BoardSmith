/**
 * The shape of cribbage's play-then-score hand, reduced to its bones (#321).
 * Each seat plays the one card in its hand in an ordinary action step, then
 * every seat acknowledges the score in ONE simultaneous step, and the game
 * is over once every seat has acknowledged.
 *
 * Entering the simultaneous step used to leave the last action step's
 * `currentPlayer` and `availableActions` on the flow state beside the new
 * `awaitingPlayers`, so the state said seat 2 could still `playCard` from an
 * empty hand. Every reader that checked those fields first believed it.
 *
 * Usable two ways: the direct `Game` API (`new PlayThenAcknowledgeGame(...)`,
 * `startFlow`, `continueFlow`) for engine tests, and
 * `createHeadlessSession(playThenAcknowledgeFixtureDefinition, ...)` for the
 * session layer's broadcasts.
 */

import {
  Game,
  Player,
  Action,
  sequence,
  eachPlayer,
  actionStep,
  simultaneousActionStep,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

class HandPlayer extends Player<PlayThenAcknowledgeGame, HandPlayer> {
  hand: number[] = [];
  acknowledged = false;
}

class PlayThenAcknowledgeGame extends Game<PlayThenAcknowledgeGame, HandPlayer> {
  static PlayerClass = HandPlayer;

  constructor(options: GameOptions) {
    super(options);
    for (const player of this.players) player.hand = [player.seat];

    this.registerActions(
      Action.create<PlayThenAcknowledgeGame>('playCard')
        .chooseFrom('card', { choices: (ctx) => [...(ctx.player as HandPlayer).hand] })
        .execute((args, ctx) => {
          const player = ctx.player as HandPlayer;
          player.hand = player.hand.filter((card) => card !== args.card);
          return { success: true };
        }),
      Action.create<PlayThenAcknowledgeGame>('acknowledgeScore')
        .condition({
          'has not acknowledged yet': (ctx) => !(ctx.player as HandPlayer).acknowledged,
        })
        .execute((_args, ctx) => {
          (ctx.player as HandPlayer).acknowledged = true;
          return { success: true };
        }),
    );

    this.setFlow({
      root: sequence(
        eachPlayer({ do: actionStep({ actions: ['playCard'] }) }),
        simultaneousActionStep({
          name: 'scoring',
          actions: ['acknowledgeScore'],
          playerDone: (_ctx, player) => (player as HandPlayer).acknowledged,
        }),
      ),
    });
  }
}

export { PlayThenAcknowledgeGame, HandPlayer };

export const playThenAcknowledgeFixtureDefinition: GameDefinitionLike = {
  gameClass: PlayThenAcknowledgeGame,
  gameType: 'play-then-acknowledge',
  minPlayers: 2,
  maxPlayers: 2,
};
