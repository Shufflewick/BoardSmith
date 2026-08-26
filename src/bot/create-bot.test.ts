/**
 * `createBot` is the documented entry point for bot opponents. Its existing
 * tests live in files vitest EXCLUDES (they need the external
 * `@boardsmith/checkers-rules` package), so within the suite that actually runs
 * it was never called. This file exercises it against a local test game.
 *
 * Driven through `GameRunner` — the same path `benchmark.ts` uses — because the
 * runner is what owns seat handling and action history; `game.performAction`
 * takes a Player object rather than a seat and is not the seat-level API.
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
import { GameRunner } from '../runtime/index.js';
import { createBot, MCTSBot, DIFFICULTY_PRESETS } from './index.js';

/** Players race to 4; there is always a strongest move, so search has a job. */
class RaceGame extends Game<RaceGame, Player> {
  scores: Record<number, number> = {};

  constructor(options: GameOptions) {
    super(options);
    for (const player of this.players) this.scores[player.seat] = 0;

    this.registerAction(
      Action.create<RaceGame>('take')
        .chooseFrom('value', { choices: [1, 2, 3] })
        .execute((args, ctx) => {
          const game = ctx.game as RaceGame;
          game.scores[ctx.player.seat] = (game.scores[ctx.player.seat] ?? 0) + (args.value as number);
          const best = Math.max(...Object.values(game.scores));
          if (best >= 4) {
            game.finish(game.players.filter((p) => game.scores[p.seat] === best));
          }
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: (ctx: FlowContext) => !(ctx.game as RaceGame).isFinished(),
          maxIterations: 50,
          do: eachPlayer({ do: actionStep({ actions: ['take'] }) }),
        }),
      }),
    );
  }
}

/** A started runner, ready for a bot to act on. */
const newRunner = (seed = 'bot-seed') => {
  const runner = new GameRunner({
    GameClass: RaceGame,
    gameType: 'race',
    gameOptions: { playerCount: 2, seed },
  });
  runner.start();
  return runner;
};

type Runner = ReturnType<typeof newRunner>;

const botFor = (
  runner: Runner,
  seat = 1,
  difficulty: Parameters<typeof createBot>[5] = 20,
  botStrategy?: unknown,
) => createBot(runner.game, RaceGame, 'race', seat, runner.actionHistory, difficulty, botStrategy as never);

/** Search bounded by iterations alone — the wall clock cannot cut it short. */
const deterministic = (bot: ReturnType<typeof botFor>) => {
  (bot as unknown as { config: { timeout: number } }).config.timeout = Infinity;
  return bot;
};

describe('createBot', () => {
  it('builds an MCTS bot', () => {
    expect(botFor(newRunner())).toBeInstanceOf(MCTSBot);
  });

  it('reads a numeric difficulty as an iteration budget', () => {
    const bot = botFor(newRunner(), 1, 250) as unknown as { config: { iterations: number } };
    expect(bot.config.iterations).toBe(250);
  });

  it('applies a named difficulty preset', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const bot = botFor(newRunner(), 1, level) as unknown as {
        config: { iterations: number; playoutDepth: number };
      };
      expect(bot.config.iterations).toBe(DIFFICULTY_PRESETS[level].iterations);
      expect(bot.config.playoutDepth).toBe(DIFFICULTY_PRESETS[level].playoutDepth);
    }
  });

  it('defaults to the medium preset', () => {
    const runner = newRunner();
    const bot = createBot(runner.game, RaceGame, 'race', 1) as unknown as {
      config: { iterations: number };
    };
    expect(bot.config.iterations).toBe(DIFFICULTY_PRESETS.medium.iterations);
  });

  it('fills unset fields from the default config, so no field is undefined', () => {
    const bot = botFor(newRunner(), 1, 'easy') as unknown as { config: Record<string, unknown> };
    for (const key of ['iterations', 'playoutDepth', 'timeout', 'async']) {
      expect(bot.config[key], key).toBeDefined();
    }
  });

  it('returns a legal move for the seat it plays', async () => {
    const move = (await botFor(newRunner()).play())!;
    expect(move.action).toBe('take');
    expect([1, 2, 3]).toContain(move.args.value);
  });

  it('produces a move the engine actually accepts', async () => {
    const runner = newRunner();
    const move = (await botFor(runner).play())!;
    expect(runner.performAction(move.action, 1, move.args).success).toBe(true);
  });

  it('plays for the seat it was given, not always the first', async () => {
    const runner = newRunner();
    runner.performAction('take', 1, { value: 1 });
    const move = (await botFor(runner, 2).play())!;
    expect(runner.performAction(move.action, 2, move.args).success).toBe(true);
    expect(runner.game.scores[2]).toBeGreaterThan(0);
  });

  it('is reproducible for the same seed when the clock cannot cut search short', async () => {
    // Without `timeout: Infinity` the wall-clock budget ends the search at
    // whatever iteration the machine happened to reach, so two runs diverge.
    const move = async () => deterministic(botFor(newRunner('fixed'), 1, 30)).play();
    expect(await move()).toEqual(await move());
  });

  it('accepts a bot config with objectives and still returns a move', async () => {
    const bot = botFor(newRunner(), 1, 20, {
      objectives: () => [{ id: 'lead', weight: 1, checker: () => true }],
    });
    expect(bot).toBeInstanceOf(MCTSBot);
    expect((await bot.play())!.action).toBe('take');
  });

  it('takes the winning move when the game is one move from over', async () => {
    // The winning position is reached through REAL actions, so it survives the
    // clone-and-replay the search does: custom game properties like `scores`
    // are rebuilt from the action history, not copied.
    const runner = newRunner();
    runner.performAction('take', 1, { value: 3 });
    runner.performAction('take', 2, { value: 1 });
    expect(runner.game.scores[1]).toBe(3);

    const move = (await deterministic(botFor(runner, 1, 200)).play())!;
    runner.performAction(move.action, 1, move.args);

    expect(runner.game.isFinished()).toBe(true);
    expect(runner.game.settings.winners).toEqual([1]);
  });

  it('leaves the live game untouched while searching', async () => {
    const runner = newRunner();
    const before = JSON.stringify(runner.game.toJSON());
    await botFor(runner, 1, 50).play();
    expect(JSON.stringify(runner.game.toJSON())).toBe(before);
    expect(runner.game.scores).toEqual({ 1: 0, 2: 0 });
  });
});
