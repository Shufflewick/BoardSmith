/**
 * `benchmarkBot` is how training decides whether a set of weights is any good.
 * The number it reports drives evolution, so the seat-swapping bookkeeping has
 * to be exactly right — a trained bot benchmarked only as player 1 would score
 * first-player advantage as skill.
 *
 * The fixtures below are deliberately tiny and decided by the game, not by
 * search quality, so the assertions are about the accounting rather than about
 * how well MCTS plays.
 */
import { describe, it, expect } from 'vitest';
import { benchmarkBot } from './benchmark.js';
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
  return benchmarkBot(DecisiveGame, 'decisive', noObjectives, {
    gameCount,
    mctsIterations: 1,
    maxActions: 10,
    timeout: 5000,
    seed: 'bench-test',
  });
};

describe('benchmarkBot', () => {
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
      incomplete: 0,
      incompleteRate: 0,
      failures: [],
      gamesPlayed: 0,
      gamesAttempted: 0,
      gamesAsPlayer0: 0,
      gamesAsPlayer1: 0,
      winRateAsPlayer0: 0,
      winRateAsPlayer1: 0,
    });
  });

  it('counts a completed game with no winner as a draw — that IS a draw', async () => {
    // FixedWinnerGame's eachPlayer flow completes once both seats have acted,
    // and finish() names no winner. The game decided a tie, so a draw is the
    // honest reading. What must NOT be a draw is a game that never got there
    // (#37) — see the incomplete-outcome tests below.
    const result = await benchmarkBot(FixedWinnerGame, 'fixed', noObjectives, {
      gameCount: 2,
      mctsIterations: 1,
      maxActions: 4,
      timeout: 5000,
      seed: 'never-ends',
    });
    expect(result.gamesPlayed).toBe(2);
    expect(result.draws).toBe(2);
    expect(result.incomplete).toBe(0);
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
    const result = await benchmarkBot(DecisiveGame, 'decisive', [{
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

/**
 * A game whose action always throws — the shape a trained bot with a broken
 * objectives function produces. It used to be indistinguishable from a
 * competitive matchup (#37): the benchmark substituted a random bot for the
 * crashing one and scored crashed games as draws, so a bot that failed on
 * every single call reported roughly a 50% win rate and weight evolution then
 * optimized pure noise.
 */
class ExplodingGame extends Game<ExplodingGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<ExplodingGame>('move')
        .chooseFrom('value', { choices: [1, 2] })
        .execute(() => {
          throw new Error('objectives function is broken');
        }),
    );

    this.setFlow(
      defineFlow({
        root: eachPlayer({ do: actionStep({ actions: ['move'] }) }),
      }),
    );
  }
}

describe('benchmarkBot on a game that cannot finish (#37)', () => {
  const runExploding = (overrides: Record<string, unknown> = {}) =>
    benchmarkBot(ExplodingGame, 'exploding', noObjectives, {
      gameCount: 4,
      mctsIterations: 1,
      maxActions: 10,
      timeout: 5000,
      seed: 'explode',
      ...overrides,
    });

  it('refuses to report a win rate built on games that never finished', async () => {
    await expect(runExploding()).rejects.toThrow(/did not finish/i);
  });

  it('says how many games failed, so the number is not a mystery', async () => {
    await expect(runExploding()).rejects.toThrow(/4 of 4/);
  });

  it('counts them as their own outcome rather than folding them into draws', async () => {
    const result = await runExploding({ allowIncomplete: true });
    expect(result.incomplete).toBe(4);
    expect(result.draws).toBe(0);
    expect(result.wins).toBe(0);
    expect(result.losses).toBe(0);
  });

  it('keeps an unfinished game out of the win-rate denominator', async () => {
    const result = await runExploding({ allowIncomplete: true });
    // Nothing was decided, so there is no rate to report — not 0.5.
    expect(result.gamesPlayed).toBe(0);
    expect(result.winRate).toBe(0);
    expect(result.incompleteRate).toBe(1);
  });

  it('records why, so the failure can be fixed rather than guessed at', async () => {
    const result = await runExploding({ allowIncomplete: true });
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.join('\n')).toMatch(/could not be completed|broken/i);
  });
});

describe('a healthy benchmark reports no failures', () => {
  it('leaves the failure counters empty', async () => {
    const result = await benchmark(4, 'seat1');
    expect(result.incomplete).toBe(0);
    expect(result.incompleteRate).toBe(0);
    expect(result.failures).toEqual([]);
    expect(result.gamesPlayed).toBe(4);
  });
});
