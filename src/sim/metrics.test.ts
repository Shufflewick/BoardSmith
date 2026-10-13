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
  sequence,
  defineMetrics,
  type GameOptions,
} from '../engine/index.js';
import { playGame, type SingleGameResult } from './play-game.js';
import { random, greedy, mcts, type Policy } from './index.js';

const metrics = defineMetrics(({ count, segment, finalScore }) => ({
  takes: count(),
  rounds: count(),
  parity: segment((_game: RaceGame, player) => (player.seat % 2 === 1 ? 'odd' : 'even')),
  score: finalScore((game: RaceGame, player) => game.scores[player.seat]),
}));

/** Each seat adds 1 or 2 to its score until someone reaches 6; adding 3 is refused after it records. */
class RaceGame extends Game<RaceGame, Player> {
  scores: Record<number, number> = {};

  constructor(options: GameOptions) {
    super(options);
    for (const player of this.players) this.scores[player.seat] = 0;
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

const recordsOf = (result: SingleGameResult, metric: string) => result.metrics.filter((r) => r.metric === metric);

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
  it("keeps an action's records only when it commits, and every flow step's", async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await playGame(race, {
      playerCount: 2, seed: 'commit', policies: [triesThreeFirst(), triesThreeFirst()], maxActions: 100,
    });
    quiet.mockRestore();
    expect(result.error).toBeUndefined();
    expect(result.completed).toBe(true);
    // Half the attempts were refused after recording; only the committed ones count.
    expect(recordsOf(result, 'takes')).toHaveLength(result.actionCount);
    expect(recordsOf(result, 'takes').every((r) => r.key === '' && r.value === 1)).toBe(true);
    expect(recordsOf(result, 'rounds').length).toBe(Math.ceil(result.actionCount / 2));
  });

  it('keeps no records from the games an MCTS seat searches', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await playGame(race, { playerCount: 2, seed: 'mcts', policies: [mcts(30), random()], maxActions: 100 });
    quiet.mockRestore();
    expect(result.completed).toBe(true);
    expect(recordsOf(result, 'takes')).toHaveLength(result.actionCount);
  });

  it('reads segment and finalScore once per player when the game ends', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await playGame(race, {
      playerCount: 3, seed: 'end', policies: [random(), random(), random()], maxActions: 100,
    });
    quiet.mockRestore();
    expect(result.completed).toBe(true);
    expect(recordsOf(result, 'parity')).toEqual([
      { metric: 'parity', key: 'odd', value: 1 },
      { metric: 'parity', key: 'even', value: 2 },
      { metric: 'parity', key: 'odd', value: 3 },
    ]);
    expect(recordsOf(result, 'score').map((r) => r.key)).toEqual(['1', '2', '3']);
    expect(Math.max(...recordsOf(result, 'score').map((r) => r.value))).toBeGreaterThanOrEqual(6);
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
    const committed = recordsOf(result, 'committedPicks').map((r) => r.value);
    expect(committed).toEqual([4, 4]);
    expect(recordsOf(result, 'picks')).toHaveLength(4);
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
