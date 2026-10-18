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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { benchmarkBot, weightedObjectives } from './benchmark.js';
import { createBot } from '../bot/index.js';
import { GameRunner } from '../runtime/index.js';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  eachPlayer,
  actionStep,
  loop,
  sequence,
  simultaneousActionStep,
  type GameOptions,
} from '../engine/index.js';
import type { Objective } from '../bot/index.js';
import type { ObjectiveWeight } from './types.js';

// The real createBot, watched so a test can see how each move's search was set up.
vi.mock('../bot/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../bot/index.js')>();
  return { ...original, createBot: vi.fn(original.createBot) };
});

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

    this.setFlow({
      root: eachPlayer({ do: actionStep({ actions: ['move'] }) }),
    });
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

    this.setFlow({
      root: eachPlayer({ do: actionStep({ actions: ['move'] }) }),
    });
  }
}

/**
 * Ends after every seat has acted once, with seat 1 the winner, declared ONLY
 * by overriding `isFinished()` and `getWinners()` (#503). It never calls
 * `finish()`, so the benchmark has to read the result the game declares.
 */
class OverrideDeclaredGame extends Game<OverrideDeclaredGame, Player> {
  acted = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<OverrideDeclaredGame>('move')
        .chooseFrom('value', { choices: [1, 2] })
        .execute((_args, ctx) => {
          (ctx.game as OverrideDeclaredGame).acted++;
          return { success: true };
        }),
    );

    this.setFlow({
      root: eachPlayer({ do: actionStep({ actions: ['move'] }) }),
    });
  }

  override isFinished(): boolean {
    return this.acted >= this.players.length;
  }

  override getWinners(): Player[] {
    return this.isFinished() ? [this.getPlayer(1)!] : [];
  }
}

class AcknowledgingPlayer extends Player<ActThenAcknowledgeGame, AcknowledgingPlayer> {
  acknowledged = false;
}

/**
 * Each seat moves in turn, then both seats acknowledge in ONE simultaneous
 * step, and seat 1 wins. No seat is "the" current player during that step,
 * so the benchmark has to find the seats that are due from the step itself
 * (#321).
 */
class ActThenAcknowledgeGame extends Game<ActThenAcknowledgeGame, AcknowledgingPlayer> {
  static PlayerClass = AcknowledgingPlayer;

  constructor(options: GameOptions) {
    super(options);

    this.registerActions(
      Action.create<ActThenAcknowledgeGame>('move')
        .chooseFrom('value', { choices: [1, 2] })
        .execute(() => ({ success: true })),
      Action.create<ActThenAcknowledgeGame>('acknowledge')
        .condition({
          'has not acknowledged yet': (ctx) => !(ctx.player as AcknowledgingPlayer).acknowledged,
        })
        .execute((_args, ctx) => {
          (ctx.player as AcknowledgingPlayer).acknowledged = true;
          const game = ctx.game as ActThenAcknowledgeGame;
          if (game.players.every((p) => p.acknowledged)) game.finish([game.players[0]]);
          return { success: true };
        }),
    );

    this.setFlow({
      root: sequence(
        eachPlayer({ do: actionStep({ actions: ['move'] }) }),
        simultaneousActionStep({
          actions: ['acknowledge'],
          playerDone: (_ctx, player) => (player as AcknowledgingPlayer).acknowledged,
        }),
      ),
    });
  }
}

/**
 * Both seats are due in one simultaneous step, but seat 1's only action is
 * greyed out by its own `.disabled()` reason; seat 2's pick ends the game,
 * and seat 2 wins (#1133).
 */
class SitOutGame extends Game<SitOutGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<SitOutGame>('pick')
        .disabled((ctx) => (ctx.player.seat === 1 ? 'Seat 1 sits this round out.' : false))
        .chooseFrom('card', { choices: ['ace', 'king'] })
        .execute((_a, ctx) => {
          ctx.game.finish([ctx.player]);
        }),
    );
    this.setFlow({ root: simultaneousActionStep({ actions: ['pick'] }) });
  }
}

const noWeights: ObjectiveWeight[] = [];

const benchmark = (gameCount: number, outcome: typeof DecisiveGame.outcome) => {
  DecisiveGame.outcome = outcome;
  return benchmarkBot(DecisiveGame, 'decisive', undefined, noWeights, {
    gameCount,
    mctsIterations: 1,
    maxActions: 10,
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
    const result = await benchmarkBot(FixedWinnerGame, 'fixed', undefined, noWeights, {
      gameCount: 2,
      mctsIterations: 1,
      maxActions: 4,
      seed: 'never-ends',
    });
    expect(result.gamesPlayed).toBe(2);
    expect(result.draws).toBe(2);
    expect(result.incomplete).toBe(0);
  });

  it('scores the winner a game declares by overriding getWinners(), as players are shown it', async () => {
    const result = await benchmarkBot(OverrideDeclaredGame, 'override-declared', undefined, noWeights, {
      gameCount: 4,
      mctsIterations: 1,
      maxActions: 4,
      seed: 'override-declared',
    });
    expect(result.failures).toEqual([]);
    expect(result.draws).toBe(0);
    expect(result.winRateAsPlayer0).toBe(1);
    expect(result.winRateAsPlayer1).toBe(0);
  });

  it('plays through a simultaneous step, acting for each seat that is due', async () => {
    const result = await benchmarkBot(ActThenAcknowledgeGame, 'act-then-acknowledge', undefined, noWeights, {
      gameCount: 2,
      mctsIterations: 1,
      maxActions: 10,
      seed: 'simultaneous',
    });
    expect(result.failures).toEqual([]);
    expect(result.incomplete).toBe(0);
    expect(result.gamesPlayed).toBe(2);
    expect(result.winRateAsPlayer0).toBe(1);
    expect(result.winRateAsPlayer1).toBe(0);
  });

  it('plays the due seat that can move when the first due seat is offered only disabled actions (#1133)', async () => {
    const result = await benchmarkBot(SitOutGame, 'sit-out', undefined, noWeights, {
      gameCount: 2,
      mctsIterations: 1,
      maxActions: 10,
      seed: 'sit-out',
    });
    expect(result.failures).toEqual([]);
    expect(result.incomplete).toBe(0);
    expect(result.gamesPlayed).toBe(2);
  });

  it('keeps every reported rate inside 0..1', async () => {
    const result = await benchmark(4, 'seat1');
    for (const rate of [result.winRate, result.winRateAsPlayer0, result.winRateAsPlayer1]) {
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
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

    this.setFlow({
      root: eachPlayer({ do: actionStep({ actions: ['move'] }) }),
    });
  }
}

describe('benchmarkBot on a game that cannot finish (#37)', () => {
  const runExploding = (overrides: Record<string, unknown> = {}) =>
    benchmarkBot(ExplodingGame, 'exploding', undefined, noWeights, {
      gameCount: 4,
      mctsIterations: 1,
      maxActions: 10,
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

/** Seat 1 wins every game except the one played from `stallSeed`, whose move throws. */
class OneStallGame extends DecisiveGame {
  static stallSeed = 'one-stall-p0-0';

  constructor(options: GameOptions) {
    super(options);
    if (options.seed === OneStallGame.stallSeed) {
      this.registerAction(
        Action.create<DecisiveGame>('move')
          .chooseFrom('value', { choices: [1, 2] })
          .execute(() => {
            throw new Error('this game cannot finish');
          }),
      );
    }
  }
}

describe('per-seat win rates with an unfinished game (#736)', () => {
  it('divide by finished games, agreeing with winRate', async () => {
    DecisiveGame.outcome = 'seat1';
    const result = await benchmarkBot(OneStallGame, 'one-stall', undefined, noWeights, {
      gameCount: 4,
      mctsIterations: 1,
      maxActions: 10,
      seed: 'one-stall',
      allowIncomplete: true,
    });
    expect(result.incomplete).toBe(1);
    // Seat 0 finished one game and won it; seat 1 finished two and lost both.
    expect(result.winRateAsPlayer0).toBe(1);
    expect(result.winRateAsPlayer1).toBe(0);
    expect(result.winRate).toBeCloseTo((1 * 1 + 0 * 2) / 3);
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

/**
 * Each seat in turn adds 1 or 2 to its own total; the first to 12 wins. Long
 * enough that a search's playouts stop before the end, so the bot scores
 * positions with its objectives rather than with the game's result.
 */
class RaceGame extends Game<RaceGame, Player> {
  /** Every step taken by any RaceGame, as `seat:by`, for a test to compare runs by. */
  static moves: string[] = [];
  totals: Record<number, number> = { 1: 0, 2: 0 };

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<RaceGame>('step')
        .chooseFrom('by', { choices: [1, 2] })
        .execute((args, ctx) => {
          const game = ctx.game as RaceGame;
          RaceGame.moves.push(`${ctx.player.seat}:${String(args.by)}`);
          game.totals[ctx.player.seat] += args.by as number;
          if (game.totals[ctx.player.seat] >= 12) game.finish([ctx.player]);
        }),
    );
    this.setFlow({ root: loop({ maxIterations: 20, do: eachPlayer({ do: actionStep({ actions: ['step'] }) }) }) });
  }
}

/** The game's own objectives, with ids no generated feature has; counts each checker's calls. */
function raceObjectives() {
  const calls = { lead: 0, 'long-stride': 0 };
  const objectives = (game: Game, seat: number): Record<string, Objective> => {
    const race = game as RaceGame;
    return {
      lead: { checker: () => (calls.lead++, race.totals[seat] > race.totals[3 - seat] ? 1 : 0), weight: 4 },
      'long-stride': { checker: () => (calls['long-stride']++, race.totals[seat] / 12), weight: 2 },
    };
  };
  return { calls, objectives };
}

describe("benchmarkBot scores the game's own objectives (#523)", () => {
  const config = { gameCount: 2, mctsIterations: 20, maxActions: 40, seed: 'race' };

  it("calls every one of the game's objective checkers", async () => {
    const { calls, objectives } = raceObjectives();
    const result = await benchmarkBot(RaceGame, 'race', { objectives }, [
      { id: 'lead', weight: 6 },
      { id: 'long-stride', weight: -1 },
    ], config);

    expect(result.gamesPlayed).toBe(2);
    expect(calls.lead).toBeGreaterThan(0);
    expect(calls['long-stride']).toBeGreaterThan(0);
  });

  it('refuses, naming it, a weight for an objective the game does not define', async () => {
    const { calls, objectives } = raceObjectives();
    await expect(
      benchmarkBot(RaceGame, 'race', { objectives }, [{ id: 'lead', weight: 6 }, { id: 'ghost', weight: 1 }], config),
    ).rejects.toThrow(/'ghost'/);
    expect(calls.lead).toBe(0);
  });

  it('refuses weights for a game whose bot has no objectives', async () => {
    await expect(benchmarkBot(RaceGame, 'race', undefined, [{ id: 'lead', weight: 6 }], config))
      .rejects.toThrow(/no bot\.objectives/);
  });
});

describe('weightedObjectives', () => {
  const game = new RaceGame({ playerCount: 2, seed: 'weighted' });

  it("gives an objective the evolved weight and keeps the game's checker", () => {
    const { calls, objectives } = raceObjectives();
    const weighted = weightedObjectives(objectives, [{ id: 'lead', weight: 9 }])(game, 1);

    expect(weighted.lead.weight).toBe(9);
    weighted.lead.checker(game, 1);
    expect(calls.lead).toBe(1);
  });

  it("keeps the game's own weight for an objective with no evolved weight", () => {
    const { objectives } = raceObjectives();
    expect(weightedObjectives(objectives, [{ id: 'lead', weight: 9 }])(game, 1)['long-stride'].weight).toBe(2);
  });
});

/** A card in a seat's hidden hand, or in the face-down pile. */
class HiddenCard extends Piece<HiddenHandGame> {
  rank!: number;
}
class HiddenHand extends Space<HiddenHandGame> {}
class HiddenPile extends Space<HiddenHandGame> {}

/**
 * Each seat is dealt four of twelve shuffled cards that only it can see and
 * plays them one at a time; the higher total wins. Every move is the pick of
 * an element the other seat cannot see, so a search samples the hidden cards,
 * and the element ids, which the engine mints under a fresh key per game, are
 * what the moves name.
 */
class HiddenHandGame extends Game<HiddenHandGame, Player> {
  /** Every card played by any HiddenHandGame, as `seat:rank`, in play and in search. */
  static moves: string[] = [];
  totals: Record<number, number> = { 1: 0, 2: 0 };

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([HiddenCard, HiddenHand, HiddenPile]);
    const pile = this.create(HiddenPile, 'pile');
    for (let rank = 1; rank <= 12; rank++) pile.create(HiddenCard, `card-${rank}`, { rank });
    pile.contentsHidden();
    pile.shuffle();
    for (const player of this.all(Player)) {
      const hand = this.create(HiddenHand, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      for (let i = 0; i < 4; i++) pile.first(HiddenCard)!.putInto(hand);
    }
    this.registerAction(
      Action.create<HiddenHandGame>('play')
        .chooseElement('card', {
          elementClass: HiddenCard,
          filter: (card, ctx) => (card.parent as HiddenHand).player === ctx.player,
        })
        .execute((args, ctx) => {
          const game = ctx.game as HiddenHandGame;
          const card = args.card as HiddenCard;
          HiddenHandGame.moves.push(`${ctx.player.seat}:${card.rank}`);
          game.totals[ctx.player.seat] += card.rank;
          card.putInto(game.first(HiddenPile)!);
          if (game.all(HiddenHand).every((hand) => hand.all(HiddenCard).length === 0)) {
            game.finish([game.players[game.totals[1] >= game.totals[2] ? 0 : 1]]);
          }
        }),
    );
    this.setFlow({ root: loop({ maxIterations: 10, do: eachPlayer({ do: actionStep({ actions: ['play'] }) }) }) });
  }
}

describe('a reproducible benchmark is repeatable move for move (#699)', () => {
  type RunConfig = { seed?: string; reproducible?: boolean; timeout?: number };
  const race = (config: RunConfig) =>
    benchmarkBot(RaceGame, 'race', undefined, noWeights, { gameCount: 4, mctsIterations: 8, maxActions: 40, ...config });

  /** Every move made, in play and in search, by one benchmark run. */
  async function movesOf(config: RunConfig): Promise<string[]> {
    RaceGame.moves = [];
    await race(config);
    return RaceGame.moves;
  }

  beforeEach(() => vi.mocked(createBot).mockClear());

  it('makes the same moves, in play and in every search, when run twice', async () => {
    const first = await movesOf({ seed: 'twice', reproducible: true });
    const second = await movesOf({ seed: 'twice', reproducible: true });
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it('makes the same element picks from hidden hands when run twice, with no fixed element id key', async () => {
    const run = async () => {
      HiddenHandGame.moves = [];
      const result = await benchmarkBot(HiddenHandGame, 'hidden-hand', undefined, noWeights, {
        gameCount: 4, mctsIterations: 10, maxActions: 40, seed: 'hidden', reproducible: true,
      });
      return { result, moves: HiddenHandGame.moves };
    };
    const first = await run();
    expect(first.result.gamesPlayed).toBe(4);
    expect(first.moves.length).toBeGreaterThan(16);
    expect(await run()).toEqual(first);
  });

  it("seeds every move's search through createBot's reproducible option, each with its own seed", async () => {
    await race({ seed: 'per-move', reproducible: true });
    const reproducible = vi.mocked(createBot).mock.calls.map((call) => call[6]);
    expect(reproducible.length).toBeGreaterThan(0);
    expect(reproducible.every((r) => typeof r?.seed === 'string')).toBe(true);
    expect(new Set(reproducible.map((r) => r!.seed)).size).toBe(reproducible.length);
  });

  it('gives different game seeds different search seeds', async () => {
    await race({ seed: 'one', reproducible: true });
    const one = vi.mocked(createBot).mock.calls.map((call) => call[6]!.seed);
    vi.mocked(createBot).mockClear();
    await race({ seed: 'two', reproducible: true });
    const two = vi.mocked(createBot).mock.calls.map((call) => call[6]!.seed);
    expect(two.some((seed) => one.includes(seed))).toBe(false);
  });

  it('leaves a benchmark that is not reproducible as it was: unseeded, clock-bounded searches, seeded games or not', async () => {
    await race({ seed: 'games-only' });
    await race({});
    const calls = vi.mocked(createBot).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call[6] === undefined)).toBe(true);
  });

  it('refuses a game timeout on a reproducible benchmark, since a clock would make it unrepeatable', async () => {
    await expect(race({ seed: 'clock', reproducible: true, timeout: 1000 })).rejects.toThrow(/reproducible.*timeout/);
    expect(createBot).not.toHaveBeenCalled();
  });
});

/** Each seat picks one of six options once; seat 1 wins. */
class SixWayGame extends Game<SixWayGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<SixWayGame>('pick')
        .chooseFrom('option', { choices: ['a', 'b', 'c', 'd', 'e', 'f'] })
        .execute((_args, ctx) => {
          if (ctx.player.seat === 2) (ctx.game as SixWayGame).finish([ctx.game.players[0]]);
        }),
    );
    this.setFlow({ root: eachPlayer({ do: actionStep({ actions: ['pick'] }) }) });
  }
}

describe('the baseline opponent picks at random from the legal moves (#734)', () => {
  /** The option the baseline seat played in each game, in order. */
  async function baselinePicks(seed: string): Promise<unknown[]> {
    const performAction = vi.spyOn(GameRunner.prototype, 'performAction');
    try {
      // 20 games: the trained bot is seat 1 in the first 10, so the baseline is seat 2 there.
      await benchmarkBot(SixWayGame, 'six-way', undefined, noWeights, {
        gameCount: 20, mctsIterations: 1, maxActions: 4, seed, reproducible: true,
      });
      return performAction.mock.calls.slice(0, 20).filter((call) => call[1] === 2).map((call) => call[2].option);
    } finally {
      performAction.mockRestore();
    }
  }

  it('does not always play the first listed move', async () => {
    const picks = await baselinePicks('spread');
    expect(picks).toHaveLength(10);
    expect(new Set(picks).size).toBeGreaterThan(1);
  });

  it('plays the same moves for the same seed', async () => {
    expect(await baselinePicks('again')).toEqual(await baselinePicks('again'));
  });
});
