/**
 * #1699: a chooseElement filter that throws reaches the author as itself.
 *
 * The engine used to replace a "Cannot read properties of undefined" TypeError
 * with advice to use `dependentFilter`, even on a first pick, and dropped the
 * original error and its stack.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Space, Action, actionStep } from '../index.js';
import { GameRunner } from '../../runtime/runner.js';

class Stone extends Piece<Yard> {}
class Pile extends Space<Yard> {}

const crash = new TypeError("Cannot read properties of undefined (reading 'roomId')");

class Yard extends Game<Yard, Player> {
  rocks!: Pile;
  /** Off while the game starts, so only the availability check under test can crash. */
  armed = false;
  constructor() {
    super({ playerCount: 1 });
    this.rocks = this.create(Pile, 'rocks');
    this.rocks.create(Stone, 'flint');
    this.registerAction(
      Action.create<Yard>('lift')
        .chooseElement('stone', {
          elementClass: Stone,
          filter: (_stone, ctx) => {
            if (ctx.game.armed) throw crash;
            return true;
          },
        })
        .execute(() => ({ success: true })),
    );
    this.setFlow({
      root: actionStep({ actions: ['lift'], player: (ctx) => ctx.game.getPlayer(1)!, repeatUntil: () => false, maxMoves: 1 }),
    });
  }
}

describe('a crashing element filter (#1699)', () => {
  it('surfaces the original error from a first pick', () => {
    const runner = new GameRunner({ GameClass: Yard, gameType: 'yard', gameOptions: { playerCount: 1, seed: 'i1699' } });
    runner.start();
    runner.game.armed = true;
    let thrown: unknown;
    try {
      runner.game.getAvailableActions(runner.game.getPlayer(1)!);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(crash);
  });
});
