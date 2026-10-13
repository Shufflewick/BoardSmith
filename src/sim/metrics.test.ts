/**
 * Author metrics in the simulator's game loop (#556): what is kept, from which
 * game, and what is refused.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  Game,
  Player,
  Action,
  loop,
  eachPlayer,
  actionStep,
  execute,
  Piece,
  sequence,
  defineMetrics,
  type GameOptions,
} from '../engine/index.js';
import { playGame, type SingleGameResult } from './play-game.js';
import { random, greedy, mcts, type Policy } from './index.js';

const metrics = defineMetrics(({ count, segment, finalScore }) => ({
  dealt: count(),
  takes: count(),
  rounds: count(),
  parity: segment((_game: RaceGame, player) => (player.seat % 2 === 1 ? 'odd' : 'even')),
  score: finalScore((game: RaceGame, player) => game.scores[player.seat]),
}));

/**
 * Each seat is dealt in the constructor, then adds 1 or 2 to its score until
 * someone reaches 6; adding 3 is refused after it records.
 */
class RaceGame extends Game<RaceGame, Player> {
  scores: Record<number, number> = {};

  constructor(options: GameOptions) {
    super(options);
    for (const player of this.players) {
      this.scores[player.seat] = 0;
      metrics.dealt.add(this);
    }
    this.registerAction(
      Action.create<RaceGame>('take')
        .chooseFrom('value', { choices: [1, 2, 3] })
        .execute((args, ctx) => {
          metrics.takes.add(ctx.game);
          if (args.value === 3) throw new Error('Three is too many.');
          ctx.game.scores[ctx.player.seat] += args.value as number;
          const best = Math.max(...Object.values(ctx.game.scores));
          if (best >= 6) ctx.game.finish(ctx.game.players.filter((p) => ctx.game.scores[p.seat] === best));
        }),
    );
    this.setFlow({
      root: loop({
        while: (ctx) => !ctx.game.isFinished(),
        maxIterations: 100,
        do: sequence(
          execute((ctx) => metrics.rounds.add(ctx.game)),
          eachPlayer({ do: actionStep({ actions: ['take'] }) }),
        ),
      }),
    });
  }
}

const race = { gameClass: RaceGame, gameType: 'race', minPlayers: 2, maxPlayers: 4, metrics };

const total = (result: SingleGameResult, metric: string) => result.metrics.totals[metric]?.[''];

/** Tries 3 (refused) before every move it plays, then takes 1 or 2 from its own generator. */
const triesThreeFirst = (): Policy => {
  let tried = false;
  return {
    name: 'tries-three-first',
    choose: (turn) => {
      tried = !tried;
      return { action: 'take', args: { value: tried ? 3 : 1 + turn.random.nextInt(2) } };
    },
  };
};

describe('author metrics in a simulated game (#556)', () => {
  it("keeps the constructor's records, an action's only when it commits, and every flow step's", async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await playGame(race, {
      playerCount: 2, seed: 'commit', policies: [triesThreeFirst(), triesThreeFirst()], maxActions: 100,
    });
    quiet.mockRestore();
    expect(result.error).toBeUndefined();
    expect(result.completed).toBe(true);
    // Half the attempts were refused after recording; only the committed ones count.
    expect(total(result, 'dealt')).toBe(2);
    expect(total(result, 'takes')).toBe(result.actionCount);
    expect(total(result, 'rounds')).toBe(Math.ceil(result.actionCount / 2));
  });

  it('keeps no records from the games an MCTS seat searches, which are dealt and played too', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await playGame(race, { playerCount: 2, seed: 'mcts', policies: [mcts(30), random()], maxActions: 100 });
    quiet.mockRestore();
    expect(result.error).toBeUndefined();
    expect(result.completed).toBe(true);
    expect(total(result, 'dealt')).toBe(2);
    expect(total(result, 'takes')).toBe(result.actionCount);
  });

  it('reads segment and finalScore once per player when the game ends', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await playGame(race, {
      playerCount: 3, seed: 'end', policies: [random(), random(), random()], maxActions: 100,
    });
    quiet.mockRestore();
    expect(result.completed).toBe(true);
    expect(result.metrics.labels.parity).toEqual(['odd', 'even', 'odd']);
    expect(result.metrics.values.score).toHaveLength(3);
    expect(Math.max(...result.metrics.values.score)).toBeGreaterThanOrEqual(6);
  });
});

const pickMetrics = defineMetrics(({ count, sample }) => ({
  picks: count(),
  committedPicks: sample({ atEnd: (game: PickGame) => game.picksCommitted }),
}));

/** One move: two picks, each recorded; the scratch copies enumerating it record nothing. */
class PickGame extends Game<PickGame, Player> {
  picksCommitted = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<PickGame>('pick')
        .chooseFrom('letters', {
          choices: ['a', 'b'],
          repeat: {
            until: (ctx) => ctx.game.picksCommitted % 2 === 0,
            onEach: (ctx) => {
              pickMetrics.picks.add(ctx.game);
              ctx.game.picksCommitted++;
            },
          },
        })
        .execute(() => {}),
    );
    this.setFlow({ root: eachPlayer({ do: actionStep({ actions: ['pick'] }) }) });
  }
}

describe('a repeating pick enumerated on scratch copies (#556)', () => {
  it('keeps only the picks of the moves played', async () => {
    const result = await playGame(
      { gameClass: PickGame, metrics: pickMetrics },
      { playerCount: 2, seed: 'scratch', policies: [greedy(() => 0), greedy(() => 0)], maxActions: 10 },
    );
    expect(result.error).toBeUndefined();
    expect(result.completed).toBe(true);
    expect(result.metrics.values.committedPicks).toEqual([4, 4]);
    expect(total(result, 'picks')).toBe(4);
  });
});

/** Records in a `choices` callback, which only describes the game. */
class PeekGame extends Game<PeekGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<PeekGame>('take')
        .chooseFrom('value', {
          choices: (ctx) => {
            metrics.takes.add(ctx.game);
            return [1];
          },
        })
        .execute(() => {}),
    );
    this.setFlow({ root: eachPlayer({ do: actionStep({ actions: ['take'] }) }) });
  }
}

const strayMetrics = defineMetrics(({ count }) => ({ stray: count() }));

/** Records a metric gameDefinition.metrics does not declare, and swallows the throw. */
class StrayGame extends Game<StrayGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<StrayGame>('take').execute((_args, ctx) => {
        try {
          strayMetrics.stray.add(ctx.game);
        } catch {
          // A game that hides the refusal still ends crashed.
        }
      }),
    );
    this.setFlow({ root: eachPlayer({ do: actionStep({ actions: ['take'] }) }) });
  }
}

describe('a record the simulator refuses ends the game, naming the metric (#556)', () => {
  it('a record in a choices callback', async () => {
    const result = await playGame(
      { gameClass: PeekGame, metrics },
      { playerCount: 2, seed: 'peek', policies: [random(), random()], maxActions: 10 },
    );
    expect(result.crashed).toBe(true);
    expect(result.error).toMatch(/Metric 'takes' was refused: it was recorded outside game code that changes the game/);
  });

  it('a record of a metric gameDefinition.metrics does not declare, even when the game catches the throw', async () => {
    const result = await playGame(
      { gameClass: StrayGame, metrics },
      { playerCount: 2, seed: 'stray', policies: [random(), random()], maxActions: 10 },
    );
    expect(result.crashed).toBe(true);
    expect(result.error).toMatch(/Metric 'stray' was refused: it is not in gameDefinition.metrics/);
  });
});

const checkedMetrics = defineMetrics(({ count, sample, category, segment, finalScore }) => ({
  amount: sample(),
  choice: category(['one', 'both']),
  gems: count({ by: 'element' }),
  side: segment((game: RefusalGame) => (game.refusal === 'empty label' ? '' : 'left')),
  points: finalScore((game: RefusalGame) => (game.refusal === 'score' ? NaN : 1)),
  leftOver: sample({ atEnd: (game: RefusalGame) => (game.refusal === 'at end' ? Infinity : 0) }),
}));

class Gem extends Piece<RefusalGame, Player> {}

/** One move each, which makes the bad record its `refusal` option names. */
class RefusalGame extends Game<RefusalGame, Player> {
  readonly refusal: string;

  constructor(options: GameOptions & { refusal?: string }) {
    super(options);
    this.refusal = options.refusal ?? '';
    this.registerElements([Gem]);
    const unnamed = this.create(Gem, '');
    this.registerAction(
      Action.create<RefusalGame>('take').execute((_args, ctx) => {
        if (ctx.game.refusal === 'number') checkedMetrics.amount.add(ctx.game, NaN);
        if (ctx.game.refusal === 'category') checkedMetrics.choice.record(ctx.game, 'none' as 'one');
        if (ctx.game.refusal === 'element') checkedMetrics.gems.add(ctx.game, unnamed);
      }),
    );
    this.setFlow({ root: eachPlayer({ do: actionStep({ actions: ['take'] }) }) });
  }
}

describe('a record or end-of-game read that is not a usable value ends the game, naming the metric (#556)', () => {
  const refused = (refusal: string) => playGame(
    { gameClass: RefusalGame, metrics: checkedMetrics },
    { playerCount: 2, seed: 'refuse', policies: [random(), random()], maxActions: 10, gameOptions: { refusal } },
  );

  it.each([
    ['number', /Metric 'amount' was refused: it was given NaN, which is not a finite number/],
    ['category', /Metric 'choice' was refused: 'none' is not one of its values \(one, both\)/],
    ['element', /Metric 'gems' was refused: it is counted by element, so name an element that has a name/],
    ['empty label', /Segment 'side' gave "" for seat 1\. Return a non-empty label/],
    ['score', /Metric 'points' gave NaN for seat 1\. Return a finite number/],
    ['at end', /Metric 'leftOver' gave Infinity for seat 1\. Return a finite number/],
  ])('%s', async (refusal, message) => {
    const result = await refused(refusal);
    expect(result.crashed).toBe(true);
    expect(result.error).toMatch(message);
  });

  it('a game with good values completes', async () => {
    const result = await refused('');
    expect(result.error).toBeUndefined();
    expect(result.completed).toBe(true);
  });
});
