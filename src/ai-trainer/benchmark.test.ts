/**
 * `benchmarkAI` is how training decides whether a set of weights is any good.
 * The number it reports drives evolution, so the seat-swapping bookkeeping has
 * to be exactly right — a trained bot benchmarked only as player 1 would score
 * first-player advantage as skill.
 *
 * The fixtures below are deliberately tiny and decided by the game, not by
 * search quality, so the assertions are about the accounting rather than about
 * how well MCTS plays.
 */
import { describe, it, expect } from 'vitest';
import { benchmarkAI } from './benchmark.js';
import {
  Game,
  Player,
  Action,
  defineFlow,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import type { LearnedObjective } from './types.js';

/** Every player acts once; the seat named by `winningSeat` always wins. */
class FixedWinnerGame extends Game<FixedWinnerGame, Player> {
  static winningSeat: number | 'draw' | 'none' = 1;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<FixedWinnerGame>('move')
        .chooseFrom('value', { choices: [1, 2] })
        .execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: eachPlayer({ do: actionStep({ actions: ['move'] }) }),
      }),
    );
  }

  override finish(winners?: Player[]): void {
    super.finish(winners);
  }
}

/** Ends the game after the last seat acts, awarding the configured outcome. */
class DecisiveGame extends Game<DecisiveGame, Player> {
  static outcome: 'seat1' | 'seat2' | 'draw' | 'noWinner' = 'seat1';
  acted = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<DecisiveGame>('move')
        .chooseFrom('value', { choices: [1, 2] })
        .execute((_args, ctx) => {
          const game = ctx.game as DecisiveGame;
          game.acted++;
          if (game.acted >= game.players.length) {
            const outcome = (game.constructor as typeof DecisiveGame).outcome;
            if (outcome === 'seat1') game.finish([game.players[0]]);
            else if (outcome === 'seat2') game.finish([game.players[1]]);
            else if (outcome === 'draw') game.finish(game.players);
            else game.finish([]);
          }
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: eachPlayer({ do: actionStep({ actions: ['move'] }) }),
      }),
    );
  }
}

const noObjectives: LearnedObjective[] = [];

const benchmark = (gameCount: number, outcome: typeof DecisiveGame.outcome) => {
  DecisiveGame.outcome = outcome;
  return benchmarkAI(DecisiveGame, 'decisive', noObjectives, {
    gameCount,
    mctsIterations: 1,
    maxActions: 10,
    timeout: 5000,
    seed: 'bench-test',
  });
};

describe('benchmarkAI', () => {
  it('plays the requested number of games', async () => {
    const result = await benchmark(4, 'seat1');
    expect(result.gamesPlayed).toBe(4);
  });

  it('splits the games evenly between both seats', async () => {
    const result = await benchmark(4, 'seat1');
    expect(result.gamesAsPlayer0).toBe(2);
    expect(result.gamesAsPlayer1).toBe(2);
  });

  it('plays the odd game out as player 0', async () => {
    const result = await benchmark(5, 'seat1');
    expect(result.gamesPlayed).toBe(5);
    expect(result.gamesAsPlayer0).toBe(3);
    expect(result.gamesAsPlayer1).toBe(2);
  });

  it('counts wins, losses and draws so they add up to the games played', async () => {
    const result = await benchmark(4, 'seat1');
    expect(result.wins + result.losses + result.draws).toBe(result.gamesPlayed);
  });

  it('scores a seat-1-always-wins game as 100% for the trained bot in seat 1 only', async () => {
    const result = await benchmark(4, 'seat1');
    expect(result.winRateAsPlayer0).toBe(1);
    expect(result.winRateAsPlayer1).toBe(0);
  });

  it('reports the overall win rate as wins over games played', async () => {
    const result = await benchmark(4, 'seat1');
    expect(result.winRate).toBeCloseTo(result.wins / result.gamesPlayed, 10);
    expect(result.winRate).toBe(0.5);
  });

  it('mirrors the accounting when the other seat always wins', async () => {
    const result = await benchmark(4, 'seat2');
    expect(result.winRateAsPlayer0).toBe(0);
    expect(result.winRateAsPlayer1).toBe(1);
    expect(result.winRate).toBe(0.5);
  });

  it('counts a shared win as a draw, not a win', async () => {
    const result = await benchmark(2, 'draw');
    expect(result.draws).toBe(2);
    expect(result.wins).toBe(0);
    expect(result.losses).toBe(0);
    expect(result.winRate).toBe(0);
  });

  it('counts a winnerless finish as a draw', async () => {
    const result = await benchmark(2, 'noWinner');
    expect(result.draws).toBe(2);
    expect(result.winRate).toBe(0);
  });

  it('is reproducible for the same seed', async () => {
    const first = await benchmark(2, 'seat1');
    const second = await benchmark(2, 'seat1');
    expect(second).toEqual(first);
  });

  it('returns a zeroed result for a benchmark of no games', async () => {
    const result = await benchmark(0, 'seat1');
    expect(result).toEqual({
      winRate: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      gamesPlayed: 0,
      gamesAsPlayer0: 0,
      gamesAsPlayer1: 0,
      winRateAsPlayer0: 0,
      winRateAsPlayer1: 0,
    });
  });

  it('treats a game that never completes as a draw rather than hanging', async () => {
    // FixedWinnerGame never calls finish(), so the flow runs out of actions.
    const result = await benchmarkAI(FixedWinnerGame, 'fixed', noObjectives, {
      gameCount: 2,
      mctsIterations: 1,
      maxActions: 4,
      timeout: 5000,
      seed: 'never-ends',
    });
    expect(result.gamesPlayed).toBe(2);
    expect(result.draws).toBe(2);
  });

  it('keeps every reported rate inside 0..1', async () => {
    const result = await benchmark(4, 'seat1');
    for (const rate of [result.winRate, result.winRateAsPlayer0, result.winRateAsPlayer1]) {
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });

  it('runs with learned objectives supplied', async () => {
    DecisiveGame.outcome = 'seat1';
    const result = await benchmarkAI(DecisiveGame, 'decisive', [{
      featureId: 'always-true',
      description: 'always true',
      weight: 5,
      checkerCode: '() => true',
      correlation: 0.5,
    }], {
      gameCount: 2,
      mctsIterations: 1,
      maxActions: 10,
      timeout: 5000,
      seed: 'with-objectives',
    });
    expect(result.gamesPlayed).toBe(2);
  });
});
