/**
 * A draw is something the game declares, never something inferred from an
 * empty winners list (#1625). A solo game the player loses names no winner
 * and is not a draw; `finish('draw')` or an `isDraw()` override is.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, loop, type GameOptions } from '../index.js';
import { GameRunner } from '../../runtime/runner.js';

class EndGame extends Game<EndGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<EndGame>('lose').prompt('Lose').execute((_a, ctx) => {
        (ctx.game as EndGame).finish();
      }),
      Action.create<EndGame>('draw').prompt('Draw').execute((_a, ctx) => {
        (ctx.game as EndGame).finish('draw');
      }),
      Action.create<EndGame>('win').prompt('Win').execute((_a, ctx) => {
        (ctx.game as EndGame).finish([ctx.player]);
      }),
    );
    this.setFlow({
      root: loop({ maxIterations: 5, while: () => !this.isFinished(), do: actionStep({ actions: ['lose', 'draw', 'win'] }) }),
    });
  }
}

function playEnding(action: 'lose' | 'draw' | 'win', playerCount = 1) {
  const runner = new GameRunner({ GameClass: EndGame, gameType: 'end', gameOptions: { playerCount, seed: 'd1625' } });
  runner.start();
  expect(runner.performAction(action, 1, {}).success).toBe(true);
  return runner;
}

describe('a draw is declared by the game (#1625)', () => {
  it('a game finished with no winners is not a draw', () => {
    const runner = playEnding('lose');
    expect(runner.game.isFinished()).toBe(true);
    expect(runner.game.isDraw()).toBe(false);
    expect(runner.getSnapshot()).toMatchObject({ winners: [], draw: false });
  });

  it("finish('draw') declares a draw with no winners", () => {
    const runner = playEnding('draw', 2);
    expect(runner.game.isDraw()).toBe(true);
    expect(runner.getSnapshot()).toMatchObject({ winners: [], draw: true });
  });

  it('a game with a winner is not a draw', () => {
    const runner = playEnding('win', 2);
    expect(runner.game.isDraw()).toBe(false);
    expect(runner.getSnapshot()).toMatchObject({ winners: [1], draw: false });
  });

  it('a running game is not a draw, even when isDraw() says so', () => {
    class EarlyDraw extends EndGame {
      override isDraw(): boolean {
        return true;
      }
    }
    const runner = new GameRunner({ GameClass: EarlyDraw, gameType: 'end', gameOptions: { playerCount: 2, seed: 'd1625' } });
    runner.start();
    expect(runner.getSnapshot().draw).toBe(false);
  });

  it('refuses a finished game that declares a draw and names winners', () => {
    class DrawWithWinner extends EndGame {
      override isDraw(): boolean {
        return true;
      }
    }
    const runner = new GameRunner({ GameClass: DrawWithWinner, gameType: 'end', gameOptions: { playerCount: 2, seed: 'd1625' } });
    runner.start();
    expect(() => {
      runner.performAction('win', 1, {});
      runner.getSnapshot();
    }).toThrow(/declares a draw.*names seat 1 as a winner/);
  });
});
