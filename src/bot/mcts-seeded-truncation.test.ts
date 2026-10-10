import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game, Action, actionStep, loop, eachPlayer, type GameOptions } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import { DIFFICULTY_PRESETS, type BotConfig } from './types.js';

/**
 * A `seed` promises a reproducible search, but `timeout` is wall-clock — so a
 * seeded search that runs long enough to be cut short silently returns whatever
 * the machine had time for. The same seed then picks a DIFFERENT move on a
 * faster or slower machine, and the symptom is an intermittently-failing
 * tactical test with no visible cause. (Found via a real game's "deterministic"
 * bot fixture: it requested 400 iterations, the 2000ms default truncated it to
 * roughly 92, and the bot returned a worse move — with nothing in the output
 * saying so.)
 *
 * Truncation stays legitimate in production, so the bot still returns a move.
 * These tests pin that it stops being SILENT about it.
 */

class ChoiceGame extends Game {
  constructor(options: GameOptions) {
    super(options);

    // Several choices, so the bot actually searches instead of short-circuiting
    // on a single forced move.
    this.registerAction(
      Action.create('pick')
        .chooseFrom('value', { prompt: 'Pick', choices: [1, 2, 3, 4] })
        .execute(() => ({ success: true })),
    );

    this.setFlow({
      root: actionStep({ actions: ['pick'] }),
    });
  }
}

function newGame(): ChoiceGame {
  const game = new ChoiceGame({
    playerCount: 2,
    playerNames: ['Player 1', 'Player 2'],
    seed: 'game-seed',
  });
  game.startFlow();
  return game;
}

function makeBot(config: { iterations: number; seed?: string; timeout?: number }) {
  return new MCTSBot(newGame(), ChoiceGame, 'choice', 1, [], {
    playoutDepth: 2,
    async: false,
    ...config,
  });
}

describe('MCTS seeded-search truncation is never silent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns when a seeded search is cut short by the wall-clock timeout', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // timeout: 0 guarantees truncation at the very first timeout check, so this
    // asserts the CONTRACT rather than racing a real clock.
    const bot = makeBot({ iterations: 500, seed: 'fixed', timeout: 0 });
    await bot.play();

    expect(warn).toHaveBeenCalledOnce();
    const message = warn.mock.calls[0][0] as string;
    // The warning has to be actionable: name the seed, both counts, and the fix.
    expect(message).toContain('fixed');
    expect(message).toContain('500');
    expect(message).toContain('NOT reproducible');
    expect(message).toContain('timeout: Infinity');
  });

  it('stays silent for an UNSEEDED search — it never promised determinism', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const bot = makeBot({ iterations: 500, timeout: 0 });
    await bot.play();

    expect(warn).not.toHaveBeenCalled();
  });

  it('stays silent when a seeded search completes every requested iteration', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Infinity is the documented way to make a seeded search genuinely
    // reproducible: bounded by iterations alone.
    const bot = makeBot({ iterations: 5, seed: 'fixed', timeout: Infinity });
    await bot.play();

    expect(warn).not.toHaveBeenCalled();
  });

  it('warns only once per bot, so a long game does not flood the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const bot = makeBot({ iterations: 500, seed: 'fixed', timeout: 0 });
    await bot.play();
    await bot.play();
    await bot.play();

    expect(warn).toHaveBeenCalledOnce();
  });
});

/**
 * A parallel bot (the `hard` preset has `parallel: 2`) runs several
 * sub-searches and votes. Each sub-search's randomness must follow the bot's
 * own: an unseeded bot's sub-searches draw fresh random seeds, and a seeded
 * bot's derive theirs from its seed so the whole ensemble stays reproducible
 * (#329). Before this, an unseeded bot handed its sub-searches the fixed seeds
 * "default-parallel-0", "default-parallel-1", ..., so every unseeded hard bot
 * searched identically and warned about a seed nobody set.
 */

interface SubSearch { seed?: string; rngState: string }

type BotInternals = { config: BotConfig; rng: { getState(): string } };

/**
 * Run `bot.play()` and report every sub-search it started: the seed it was
 * configured with and its random source's state before it drew anything.
 */
async function subSearchesOf(bot: MCTSBot<ChoiceGame>): Promise<SubSearch[]> {
  const subs: SubSearch[] = [];
  // Each sub-search is one `runSearch` on its own bot; it is private, so the
  // spy reaches it through a cast.
  const proto = MCTSBot.prototype as unknown as { runSearch: () => Promise<unknown> };
  const runSearch = proto.runSearch;
  const spy = vi.spyOn(proto, 'runSearch').mockImplementation(function (this: MCTSBot<Game>) {
    const self = this as unknown as BotInternals;
    if (this !== (bot as unknown)) subs.push({ seed: self.config.seed, rngState: self.rng.getState() });
    return runSearch.call(this);
  });
  await bot.play();
  spy.mockRestore();
  return subs;
}

/**
 * A parallel bot shaped like the `hard` preset (its `parallel` count and
 * playout depth) that searches only a few iterations per sub-search. What these
 * tests pin is decided before a sub-search runs its first iteration (the seed it
 * gets and its random source's starting state), or needs only enough iterations
 * to draw from that source (the move a seeded ensemble returns, on `ParityGame`
 * below). The preset's 500
 * iterations bought none of it and cost several plays of up to a second each per
 * test under load, which timed out unrelated merges (#424).
 *
 * `timeout: Infinity` bounds every search by iterations alone, as `createBot`'s
 * `reproducible` does for a seeded bot (create-bot.test.ts pins that wiring), so
 * no run here depends on how busy the machine is. `async: false` skips the
 * event-loop yield between iterations, which only a live game needs.
 */
const ITERATIONS_PER_SUB_SEARCH = 8;
const parallelBot = (seed?: string) => new MCTSBot(newGame(), ChoiceGame, 'choice', 1, [], {
  ...DIFFICULTY_PRESETS.hard,
  iterations: DIFFICULTY_PRESETS.hard.parallel! * ITERATIONS_PER_SUB_SEARCH,
  timeout: Infinity,
  async: false,
  ...(seed === undefined ? {} : { seed }),
});

/**
 * A game whose best first move genuinely depends on the search's random
 * source (#427). Each seat picks 1-4 twice, alternately, and seat 1 wins when
 * the four picks sum to an even number. No first pick is better than another,
 * so which one a short search prefers comes down to how its random playouts
 * happened to fall, and that is fixed by its seed. `ChoiceGame` cannot show
 * this: it ends at the first pick, so every search scores every move the same
 * whatever its seed.
 */
class ParityGame extends Game {
  picks: number[] = [];

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('pick')
        .chooseFrom('value', { prompt: 'Pick', choices: [1, 2, 3, 4] })
        .execute((args, ctx) => {
          const game = ctx.game as ParityGame;
          game.picks = [...game.picks, args.value as number];
          return { success: true };
        }),
    );

    this.setFlow({
      root: loop({ maxIterations: 2, do: eachPlayer({ do: actionStep({ actions: ['pick'] }) }) }),
    });
  }

  override isFinished(): boolean {
    return super.isFinished() || this.picks.length >= 4;
  }

  /** Seat 1 wins when the four picks sum to an even number, seat 2 otherwise. */
  override getWinners() {
    if (!this.isFinished()) return [];
    const sum = this.picks.reduce((total, pick) => total + pick, 0);
    return [this.getPlayer(sum % 2 === 0 ? 1 : 2)!];
  }
}

function newParityGame(): ParityGame {
  const game = new ParityGame({ playerCount: 2, playerNames: ['Player 1', 'Player 2'], seed: 'game-seed' });
  game.startFlow();
  return game;
}

const PARITY_SEEDS = Array.from({ length: 12 }, (_, i) => `parity-${i}`);
const parityConfig = {
  ...DIFFICULTY_PRESETS.hard,
  iterations: DIFFICULTY_PRESETS.hard.parallel! * ITERATIONS_PER_SUB_SEARCH,
  timeout: Infinity,
  async: false,
};
const parityBot = (seed: string) =>
  new MCTSBot(newParityGame(), ParityGame, 'parity', 1, [], { ...parityConfig, seed });

describe('parallel MCTS sub-search seeding (#329)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives an unseeded parallel bot\'s sub-searches independent random seeds', async () => {
    const first = await subSearchesOf(parallelBot());
    const second = await subSearchesOf(parallelBot());

    expect(first).toHaveLength(DIFFICULTY_PRESETS.hard.parallel!);
    for (const sub of [...first, ...second]) expect(sub.seed).toBeUndefined();

    const states = [...first, ...second].map(sub => sub.rngState);
    expect(new Set(states).size).toBe(states.length);
  });

  it('derives a seeded parallel bot\'s sub-searches from its seed, so the same seed searches the same way', async () => {
    const first = await subSearchesOf(parallelBot('fixture-7'));
    const second = await subSearchesOf(parallelBot('fixture-7'));
    const other = await subSearchesOf(parallelBot('fixture-8'));

    expect(first).toHaveLength(DIFFICULTY_PRESETS.hard.parallel!);
    expect(second).toEqual(first);
    expect(new Set(first.map(sub => sub.rngState)).size).toBe(first.length);
    expect(other.map(sub => sub.rngState)).not.toEqual(first.map(sub => sub.rngState));
  });

  it('picks the same move every time for the same seed, and the seed decides which', async () => {
    const movesFor = async () => {
      const moves: unknown[] = [];
      for (const seed of PARITY_SEEDS) moves.push((await parityBot(seed).play())?.args.value);
      return moves;
    };
    const first = await movesFor();

    // The fixture has teeth: the seed actually changes the move, so a
    // sub-search that stopped following the bot's seed would show up below.
    expect(new Set(first).size).toBeGreaterThan(1);
    expect(await movesFor()).toEqual(first);
  });

  it('settles a split vote by the visits the sub-searches gave each move in total', async () => {
    let splits = 0;
    for (const seed of PARITY_SEEDS) {
      // Each sub-search on its own, configured as playParallel configures it.
      const subs = await Promise.all(
        Array.from({ length: DIFFICULTY_PRESETS.hard.parallel! }, (_, i) => new MCTSBot(
          newParityGame(), ParityGame, 'parity', 1, [],
          { ...parityConfig, iterations: ITERATIONS_PER_SUB_SEARCH, parallel: 1, seed: `${seed}-parallel-${i}` },
        ).playWithStats()),
      );
      const votes = subs.map(sub => sub.move?.args.value);
      if (new Set(votes).size < votes.length) continue;

      const visits = new Map<unknown, number>();
      for (const { stats } of subs) {
        for (const stat of stats) visits.set(stat.move.args.value, (visits.get(stat.move.args.value) ?? 0) + stat.visits);
      }
      const ranked = votes.map(vote => visits.get(vote) ?? 0);
      const most = Math.max(...ranked);
      if (ranked.filter(count => count === most).length > 1) continue;

      splits++;
      expect((await parityBot(seed).play())?.args.value).toBe(votes[ranked.indexOf(most)]);
    }
    // Enough split votes decided by visits that always taking the first
    // sub-search's move cannot pass by luck.
    expect(splits).toBeGreaterThanOrEqual(3);
  });

  it('does not warn about a seed when an unseeded hard bot\'s search is cut short', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // timeout: 0 truncates every sub-search at its first clock check.
    const bot = new MCTSBot(newGame(), ChoiceGame, 'choice', 1, [], { ...DIFFICULTY_PRESETS.hard, timeout: 0 });
    expect(await bot.play()).not.toBeNull();

    expect(warn).not.toHaveBeenCalled();
  });
});
