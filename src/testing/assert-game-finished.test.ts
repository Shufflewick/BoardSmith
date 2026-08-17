/**
 * `assertGameFinished` from `boardsmith/testing` — the end-of-game assertion
 * every game's own test suite closes with. `assertions.test.ts` covers the
 * other assertions in the same module.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
  type FlowContext,
} from '../engine/index.js';
import { TestGame } from './test-game.js';
import { assertGameFinished } from './assertions.js';

/**
 * Each `claim` adds a point. The game ends when someone reaches 2 points,
 * and the seat(s) on the highest score win — so a test can drive a solo
 * winner or a draw deliberately.
 */
class RaceGame extends Game<RaceGame, Player> {
  scores: Record<number, number> = {};

  constructor(options: GameOptions) {
    super(options);
    for (const player of this.players) this.scores[player.seat] = 0;

    this.registerAction(
      Action.create<RaceGame>('claim')
        .chooseFrom('points', { choices: [0, 1] })
        .execute((args, ctx) => {
          const game = ctx.game as RaceGame;
          game.scores[ctx.player.seat] += args.points as number;
          const best = Math.max(...Object.values(game.scores));
          if (best >= 2) {
            game.finish(game.players.filter((p) => game.scores[p.seat] === best));
          }
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: (ctx: FlowContext) => !(ctx.game as RaceGame).isFinished(),
          maxIterations: 100,
          do: eachPlayer({ do: actionStep({ actions: ['claim'] }) }),
        }),
      }),
    );
  }
}

const newGame = () => TestGame.create(RaceGame, { playerCount: 2 });

/**
 * Drive the game so seat 1 wins outright. The round is played out to its end
 * because `isComplete()` tracks the FLOW, not `game.finish()` — the loop only
 * re-reads its `while` condition once every seat in the round has acted.
 */
const seatOneWins = () => {
  const testGame = newGame();
  testGame.doAction(1, 'claim', { points: 1 });
  testGame.doAction(2, 'claim', { points: 0 });
  testGame.doAction(1, 'claim', { points: 1 });
  testGame.doAction(2, 'claim', { points: 0 });
  return testGame;
};

/** Drive the game so both seats finish level. */
const drawnGame = () => {
  const testGame = newGame();
  testGame.doAction(1, 'claim', { points: 1 });
  testGame.doAction(2, 'claim', { points: 1 });
  testGame.doAction(1, 'claim', { points: 1 });
  testGame.doAction(2, 'claim', { points: 1 });
  return testGame;
};

describe('assertGameFinished', () => {
  it('passes for a finished game when no winner is specified', () => {
    expect(() => assertGameFinished(seatOneWins())).not.toThrow();
  });

  it('throws when the game is still in progress', () => {
    expect(() => assertGameFinished(newGame()))
      .toThrow('Expected game to be finished, but it is not complete');
  });

  it('throws on an unfinished game even when a winner is claimed', () => {
    expect(() => assertGameFinished(newGame(), { winner: 1 }))
      .toThrow('not complete');
  });

  it('passes when the named seat is the sole winner', () => {
    expect(() => assertGameFinished(seatOneWins(), { winner: 1 })).not.toThrow();
  });

  it('throws, naming the actual winners, when a different seat won', () => {
    expect(() => assertGameFinished(seatOneWins(), { winner: 2 }))
      .toThrow('Expected player 2 to win, but winners are: [1]');
  });

  it('throws when a sole winner is claimed but the game was drawn', () => {
    expect(() => assertGameFinished(drawnGame(), { winner: 1 }))
      .toThrow(/Expected player 1 to win, but winners are: \[1, 2\]/);
  });

  it('passes when the full winner set matches a draw', () => {
    expect(() => assertGameFinished(drawnGame(), { winners: [1, 2] })).not.toThrow();
  });

  it('does not care about the order the winners are listed in', () => {
    expect(() => assertGameFinished(drawnGame(), { winners: [2, 1] })).not.toThrow();
  });

  it('throws when the expected winner set is a different size', () => {
    expect(() => assertGameFinished(drawnGame(), { winners: [1] }))
      .toThrow('Expected winners [1], but got [1, 2]');
  });

  it('throws when the expected winner set names a seat that did not win', () => {
    expect(() => assertGameFinished(seatOneWins(), { winners: [2] }))
      .toThrow('Expected winners [2], but got [1]');
  });

  it('passes for a single-element winners array on a solo win', () => {
    expect(() => assertGameFinished(seatOneWins(), { winners: [1] })).not.toThrow();
  });

  it('checks both constraints when winner and winners are given together', () => {
    expect(() => assertGameFinished(seatOneWins(), { winner: 1, winners: [1] })).not.toThrow();
    expect(() => assertGameFinished(seatOneWins(), { winner: 1, winners: [1, 2] }))
      .toThrow('Expected winners [1, 2]');
  });

  it('returns nothing — it is an assertion, not a query', () => {
    expect(assertGameFinished(seatOneWins(), { winner: 1 })).toBeUndefined();
  });
});
