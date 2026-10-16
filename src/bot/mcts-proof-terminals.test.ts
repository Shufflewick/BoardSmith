/**
 * Proof-number search marks only certain results as proof (#720).
 *
 * A finished game with no winner is a draw, not a loss, so the bot must not
 * refuse it as one. And a finished game reached through a dice roll is one
 * outcome of many, so the first outcome the search sees must not stand as the
 * move's proof.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  loop,
  sequence,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { BotConfig, BotStrategy } from './types.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => `proof-${i}`);

/** Seat 1 opens with `draw` (the game ends with no winner) or `doom` (play goes on, scored low). */
class DrawGame extends Game<DrawGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<DrawGame>('open')
        .chooseFrom('option', { prompt: 'Open', choices: ['doom', 'draw'] })
        .execute((args) => {
          if (args.option === 'draw') this.finish();
          return { success: true };
        }),
    );
    this.registerAction(
      Action.create<DrawGame>('pass')
        .chooseFrom('option', { prompt: 'Pass', choices: ['a', 'b'] })
        .execute(() => ({ success: true })),
    );
    this.setFlow({
      root: sequence(
        actionStep({ actions: ['open'] }),
        loop({ maxIterations: 100, do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }) }),
      ),
    });
  }
}

/** Seat 1 picks `gamble` (wins on a 1 in 6 roll) or `safe` (wins on a 5 in 6 roll); either ends the game. */
class DiceGame extends Game<DiceGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<DiceGame>('roll')
        .chooseFrom('option', { prompt: 'Roll', choices: ['gamble', 'safe'] })
        .execute((args, ctx) => {
          const odds = args.option === 'gamble' ? 1 / 6 : 5 / 6;
          const other = this.getPlayer(ctx.player.seat === 1 ? 2 : 1)!;
          this.finish([this.random() < odds ? ctx.player : other]);
          return { success: true };
        }),
    );
    this.setFlow({
      root: loop({ maxIterations: 10, do: eachPlayer({ do: actionStep({ actions: ['roll'] }) }) }),
    });
  }
}

/** Scores every unfinished position at the bottom of the range. */
const lowStrategy: BotStrategy = {
  objectives: () => ({ nothing: { weight: 1, checker: () => 0 } }),
};

function botFor<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  seed: string,
  config: Partial<BotConfig> = {},
) {
  const game = new GameClass({ playerCount: 2, seed });
  game.startFlow();
  return new MCTSBot(
    game,
    GameClass,
    GameClass.name,
    1,
    [],
    { async: false, timeout: Infinity, seed, ...config },
    lowStrategy,
  );
}

async function picks<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  config: Partial<BotConfig> = {},
  seeds = SEEDS,
): Promise<string[]> {
  const out: string[] = [];
  for (const seed of seeds) {
    const move = await botFor(GameClass, seed, config).play();
    out.push(String(move!.args.option));
  }
  return out;
}

describe('proof-number search and uncertain results', () => {
  it('takes a draw over a position it scores lower', async () => {
    expect(await picks(DrawGame)).toEqual(SEEDS.map(() => 'draw'));
  });

  it('weighs a dice roll by its odds, not by the first outcome it saw', async () => {
    const seeds = Array.from({ length: 60 }, (_, i) => `dice-${i}`);
    expect(await picks(DiceGame, { useRAVE: false }, seeds)).toEqual(seeds.map(() => 'safe'));
  });
});
