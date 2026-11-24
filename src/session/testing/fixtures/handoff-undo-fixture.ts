/**
 * A two-seat sequence whose second step is declared `handoffUndo` (#1788):
 * seat 1 takes one action in `mover`, then `waiter` stays open on seat 2,
 * whose `answer` takes two picks.
 *
 *  - `move` changes `moved`; `lock` does too and is `.notUndoable()`.
 *  - `roll` draws a random number.
 */
import {
  Action,
  Game,
  Player,
  actionStep,
  sequence,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

export interface HandoffOptions {
  handoffUndo?: boolean;
  checkpoints?: GameDefinitionLike['checkpoints'];
  fenceRandomRewind?: boolean;
}

export function handoffDefinition(options: HandoffOptions = {}): GameDefinitionLike {
  class HandoffGame extends Game<HandoffGame, Player> {
    moved = 0;
    rolled = 0;

    constructor(gameOptions: GameOptions) {
      super(gameOptions);
      this.registerActions(
        Action.create<HandoffGame>('move').execute((_args, ctx) => { ctx.game.moved += 1; }),
        Action.create<HandoffGame>('lock').notUndoable().execute((_args, ctx) => { ctx.game.moved += 1; }),
        Action.create<HandoffGame>('roll').execute((_args, ctx) => { ctx.game.rolled = 1 + Math.floor(ctx.game.random() * 6); }),
        Action.create<HandoffGame>('answer')
          .chooseFrom('first', { choices: ['a', 'b'] })
          .chooseFrom('second', { choices: ['c', 'd'] })
          .execute(() => {}),
      );
      this.setFlow({
        root: sequence(
          actionStep({ name: 'mover', player: (ctx) => ctx.game.getPlayer(1)!, actions: ['move', 'lock', 'roll'] }),
          actionStep({ name: 'waiter', player: (ctx) => ctx.game.getPlayer(2)!, actions: ['answer'], repeatUntil: () => false, handoffUndo: options.handoffUndo }),
        ),
      });
    }
  }
  return {
    gameClass: HandoffGame,
    gameType: 'handoff-undo',
    minPlayers: 2,
    maxPlayers: 2,
    checkpoints: options.checkpoints,
    undo: { fenceRandomRewind: options.fenceRandomRewind ?? false },
  };
}

export const handoffUndoDefinition = handoffDefinition({ handoffUndo: true });
