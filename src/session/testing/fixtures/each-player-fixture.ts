/**
 * Minimal `eachPlayer` fixture. `eachPlayer` binds the current Player as a LIVE
 * element flow variable (`variables.currentPlayer`); this fixture exists to prove
 * that a game using it survives the structured-clone broadcast/postMessage and
 * executor-RPC boundaries (where a live element would throw DataCloneError) and
 * still round-trips through a snapshot.
 */

import {
  Game,
  Player,
  Action,
  defineFlow,
  actionStep,
  loop,
  eachPlayer,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

class EachPlayerGame extends Game<EachPlayerGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(Action.create('pass').execute(() => ({ success: true })));

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 100,
          do: eachPlayer({
            do: actionStep({ actions: ['pass'] }),
          }),
        }),
      }),
    );
  }
}

export { EachPlayerGame };

export const eachPlayerFixtureDefinition: GameDefinitionLike = {
  gameClass: EachPlayerGame as new (...args: unknown[]) => unknown,
  gameType: 'each-player',
  minPlayers: 2,
  maxPlayers: 4,
};
