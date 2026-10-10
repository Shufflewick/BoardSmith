import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game, Action, actionStep, type GameOptions } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import { DIFFICULTY_PRESETS } from './types.js';

/**
 * A parallel bot (the `hard` preset has `parallel: 2`) runs its sub-searches
 * one after another. They share the bot's one `timeout`, so a hard move
 * finishes within the time the preset states rather than `parallel` times it
 * (#634).
 *
 * The clock is fake: every `Date.now()` call advances it by a fixed step, so
 * no real time passes and the test asserts the fake time the move used.
 */

class ChoiceGame extends Game {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('pick')
        .chooseFrom('value', { prompt: 'Pick', choices: [1, 2, 3, 4] })
        .execute(() => ({ success: true })),
    );
    this.setFlow({ root: actionStep({ actions: ['pick'] }) });
  }
}

function newGame(): ChoiceGame {
  const game = new ChoiceGame({ playerCount: 2, playerNames: ['Player 1', 'Player 2'], seed: 'game-seed' });
  game.startFlow();
  return game;
}

/** A fake clock that moves forward `step` ms each time it is read. */
function installFakeClock(step: number): { now: () => number } {
  let now = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => (now += step));
  return { now: () => now };
}

describe('parallel MCTS time budget (#634)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finishes a hard move within the preset\'s timeout', async () => {
    const step = 10;
    const clock = installFakeClock(step);
    const timeout = DIFFICULTY_PRESETS.hard.timeout!;
    const bot = new MCTSBot(newGame(), ChoiceGame, 'choice', 1, [], { ...DIFFICULTY_PRESETS.hard, async: false });

    const start = clock.now();
    const move = await bot.play();
    const elapsed = clock.now() - start;

    expect(move).not.toBeNull();
    // Without a shared budget each sub-search could use the whole timeout. The
    // slack covers the clock reads of the one iteration that crosses the deadline.
    expect(elapsed).toBeLessThanOrEqual(timeout + 10 * step);
    // The search really ran up against the clock, so the bound above is the
    // timeout's doing and not the iteration count's.
    expect(elapsed).toBeGreaterThanOrEqual(timeout);
  });
});
