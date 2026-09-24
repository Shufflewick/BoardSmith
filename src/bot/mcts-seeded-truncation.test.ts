import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game, Action, defineFlow, actionStep, type GameOptions } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import { createBot } from './index.js';
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

    this.setFlow(defineFlow({
      root: actionStep({ actions: ['pick'] }),
    }));
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

interface SubSearch { seed?: string; rngState: number }

type BotInternals = { config: BotConfig; rng: { state: number } };

/**
 * Run `bot.play()` and report every sub-search it started: the seed it was
 * configured with and its random source's state before it drew anything.
 */
async function subSearchesOf(bot: MCTSBot<ChoiceGame>): Promise<SubSearch[]> {
  const subs: SubSearch[] = [];
  const play = MCTSBot.prototype.play;
  const spy = vi.spyOn(MCTSBot.prototype, 'play').mockImplementation(function (this: MCTSBot<Game>) {
    const self = this as unknown as BotInternals;
    if (this !== (bot as unknown)) subs.push({ seed: self.config.seed, rngState: self.rng.state });
    return play.call(this);
  });
  await bot.play();
  spy.mockRestore();
  return subs;
}

const hardBot = (seed?: string) => createBot(
  newGame(), ChoiceGame, 'choice', 1, [], 'hard', undefined, seed === undefined ? undefined : { seed },
);

describe('parallel MCTS sub-search seeding (#329)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives an unseeded hard bot\'s sub-searches independent random seeds', async () => {
    const first = await subSearchesOf(hardBot());
    const second = await subSearchesOf(hardBot());

    expect(first).toHaveLength(DIFFICULTY_PRESETS.hard.parallel!);
    for (const sub of [...first, ...second]) expect(sub.seed).toBeUndefined();

    const states = [...first, ...second].map(sub => sub.rngState);
    expect(new Set(states).size).toBe(states.length);
  });

  it('derives a seeded hard bot\'s sub-searches from its seed, so the same seed searches the same way', async () => {
    const first = await subSearchesOf(hardBot('fixture-7'));
    const second = await subSearchesOf(hardBot('fixture-7'));
    const other = await subSearchesOf(hardBot('fixture-8'));

    expect(first).toHaveLength(DIFFICULTY_PRESETS.hard.parallel!);
    expect(second).toEqual(first);
    expect(new Set(first.map(sub => sub.rngState)).size).toBe(first.length);
    expect(other.map(sub => sub.rngState)).not.toEqual(first.map(sub => sub.rngState));
  });

  it('picks the same move every time for the same seed', async () => {
    const move = async () => hardBot('fixture-7').play();
    const first = await move();
    for (let run = 0; run < 3; run++) expect(await move()).toEqual(first);
  });

  it('does not warn about a seed when an unseeded hard bot\'s search is cut short', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // timeout: 0 truncates every sub-search at its first clock check.
    const bot = new MCTSBot(newGame(), ChoiceGame, 'choice', 1, [], { ...DIFFICULTY_PRESETS.hard, timeout: 0 });
    expect(await bot.play()).not.toBeNull();

    expect(warn).not.toHaveBeenCalled();
  });
});
