/**
 * A simultaneous SECRET deployment (#449): every seat may place any number of
 * packs -- a count only that seat may see -- and then declares itself done.
 *
 *  - `placePack` changes nothing another seat can see: the count lives in
 *    `packs`, which `static visibleAttributes` withholds from every other seat
 *    and from spectators.
 *  - `burnPack` is the same, but `.notUndoable()`, so a seat's undo after it is
 *    refused -- the refusal is what a seat reads, and it must not count the
 *    other seats' actions either.
 *  - `done` is public: `isDone` is visible, and it closes the seat's part.
 *  - `placePack` also plays an animation only the placing seat may see
 *    (`animateTo`), and `signal` plays a public one (`animate`) while changing
 *    nothing else, so a test can tell a new event apart from a changed board.
 *
 * Whatever seat 1 does with `placePack`/`burnPack`, what seat 2 and a spectator
 * receive must be the same, or seat 2 can count seat 1's secret actions.
 */

import {
  Game,
  Player,
  Action,
  sequence,
  simultaneousActionStep,
  actionStep,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

class SecretDeploymentPlayer extends Player<SecretDeploymentGame, SecretDeploymentPlayer> {
  static override visibleAttributes = ['isDone'];
  packs = 0;
  isDone = false;
}

class SecretDeploymentGame extends Game<SecretDeploymentGame, SecretDeploymentPlayer> {
  static override PlayerClass = SecretDeploymentPlayer;

  constructor(options: GameOptions) {
    super(options);

    const notDone = { 'has not declared done': (ctx: { player: Player }) => !(ctx.player as SecretDeploymentPlayer).isDone };

    this.registerAction(
      Action.create('placePack')
        .condition(notDone)
        .execute((_args, ctx) => {
          const player = ctx.player as SecretDeploymentPlayer;
          player.packs += 1;
          this.animateTo(player, 'packPlaced', { packs: player.packs });
          return { success: true };
        }),
    );
    this.registerAction(
      Action.create('signal')
        .condition(notDone)
        .execute((_args, ctx) => {
          this.animate('signal', { seat: ctx.player.seat });
          return { success: true };
        }),
    );
    this.registerAction(
      Action.create('burnPack')
        .condition(notDone)
        .notUndoable()
        .execute((_args, ctx) => {
          (ctx.player as SecretDeploymentPlayer).packs += 1;
          return { success: true };
        }),
    );
    this.registerAction(
      Action.create('done')
        .condition(notDone)
        .execute((_args, ctx) => {
          (ctx.player as SecretDeploymentPlayer).isDone = true;
          return { success: true };
        }),
    );
    this.registerAction(Action.create('battle').execute(() => ({ success: true })));

    this.setFlow({
      root: sequence(
        simultaneousActionStep({
          name: 'deploy',
          players: () => this.players,
          actions: ['placePack', 'burnPack', 'signal', 'done'],
          playerDone: (_ctx, p) => (p as SecretDeploymentPlayer).isDone,
        }),
        actionStep({ name: 'battle', actions: ['battle'], player: (ctx) => ctx.game.getPlayer(1)! }),
      ),
    });
  }
}

export { SecretDeploymentGame, SecretDeploymentPlayer };

export const secretDeploymentDefinition: GameDefinitionLike = {
  gameClass: SecretDeploymentGame,
  gameType: 'secret-deployment',
  minPlayers: 2,
  maxPlayers: 2,
};
