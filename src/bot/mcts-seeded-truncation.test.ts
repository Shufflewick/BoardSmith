import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game, Action, defineFlow, actionStep, type GameOptions } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';

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

function makeBot(config: { iterations: number; seed?: string; timeout?: number }) {
  const game = new ChoiceGame({
    playerCount: 2,
    playerNames: ['Player 1', 'Player 2'],
    seed: 'game-seed',
  });
  game.startFlow();

  return new MCTSBot(game, ChoiceGame, 'choice', 1, [], {
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
