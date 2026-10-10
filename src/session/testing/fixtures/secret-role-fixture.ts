/**
 * Two seats, each with a role only that seat may see (`static visibleAttributes`
 * withholds `secretRole`), and a pick seat 2 makes over and over. Seat 1's role
 * is the string `SEAT-ONE-SECRET-ROLE`, so a test can search anything seat 2
 * is sent for it (#450).
 */

import { Game, Player, Action, actionStep, loop, type GameOptions } from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

class SecretPlayer extends Player<SecretGame, SecretPlayer> {
  static override visibleAttributes = ['publicScore'];
  publicScore = 0;
  secretRole = 'none';
}

class SecretGame extends Game<SecretGame, SecretPlayer> {
  static override PlayerClass = SecretPlayer;
  constructor(options: GameOptions) {
    super(options);
    this.getPlayer(1)!.secretRole = 'SEAT-ONE-SECRET-ROLE';
    this.getPlayer(2)!.secretRole = 'seat-two-own-role';
    this.registerAction(
      Action.create('pick')
        .chooseFrom('color', { choices: ['red', 'blue'] })
        .execute(() => ({ success: true })),
    );
    this.setFlow({
      root: loop({
        maxIterations: 100,
        do: actionStep({ actions: ['pick'], player: (ctx) => ctx.game.getPlayer(2)!, turnScope: 'restart' }),
      }),
    });
  }
}

export const secretRoleDefinition: GameDefinitionLike = { gameClass: SecretGame, gameType: 'secret', minPlayers: 2, maxPlayers: 2 };
