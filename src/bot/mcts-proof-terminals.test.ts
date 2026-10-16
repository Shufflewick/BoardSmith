/**
 * Proof-number search marks only certain results as proof (#720).
 *
 * A finished game with no winner is a draw, not a loss, so the bot must not
 * refuse it as one. And a finished game reached through a dice roll is one
 * outcome of many, so the first outcome the search sees must not stand as the
 * move's proof.
 */
import { describe, it, expect, vi } from 'vitest';
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
import type { BotConfig, BotStrategy, DeterminizeSampler } from './types.js';

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
        loop({ maxIterations: 100, do: eachPlayer({ do: actionStep({ actions: ['pass'], turnScope: 'restart' }) }) }),
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

/** Seat 1 picks `win` (the game ends with seat 1 the winner) or `wait` (play goes on); nothing is random. */
class InstantWinGame extends Game<InstantWinGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<InstantWinGame>('move')
        .chooseFrom('option', { prompt: 'Move', choices: ['wait', 'win'] })
        .execute((args, ctx) => {
          if (args.option === 'win') this.finish([ctx.player]);
          return { success: true };
        }),
    );
    this.setFlow({
      root: loop({ maxIterations: 100, do: eachPlayer({ do: actionStep({ actions: ['move'] }) }) }),
    });
  }
}

class Roller extends Player<HiddenDieGame, Roller> {
  static override visibleAttributes: string[] = [];
  /** A die only seat 2 has seen. */
  roll = 0;
}

/** Seat 1 picks `gamble` (wins if seat 2's hidden die shows 0) or `safe` (wins otherwise); either ends the game. */
class HiddenDieGame extends Game<HiddenDieGame, Roller> {
  static override PlayerClass = Roller;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<HiddenDieGame>('call')
        .chooseFrom('option', { prompt: 'Call', choices: ['gamble', 'safe'] })
        .execute((args, ctx) => {
          const holder = this.getPlayer(2)!;
          const gambleWins = holder.roll === 0;
          this.finish([(args.option === 'gamble') === gambleWins ? ctx.player : holder]);
          return { success: true };
        }),
    );
    this.setFlow({
      root: actionStep({ actions: ['call'], player: (ctx) => ctx.game.getPlayer(1)! }),
    });
  }
}

/** Rolls seat 2's hidden die afresh in each sampled world. */
const rollDie: DeterminizeSampler = (sandbox, seat, rng) => {
  const holder = (sandbox as HiddenDieGame).getPlayer(2)!;
  if (holder.seat !== seat) holder.roll = Math.floor(rng() * 6);
};

/** Scores every unfinished position at the bottom of the range. */
const lowStrategy: BotStrategy = {
  objectives: () => ({ nothing: { weight: 1, checker: () => 0 } }),
};

function botFor<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  seed: string,
  config: Partial<BotConfig> = {},
  strategy: BotStrategy = lowStrategy,
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
    strategy,
  );
}

async function picks<G extends Game>(
  GameClass: new (options: GameOptions) => G,
  config: Partial<BotConfig> = {},
  seeds = SEEDS,
  strategy?: BotStrategy,
): Promise<string[]> {
  const out: string[] = [];
  for (const seed of seeds) {
    const move = await botFor(GameClass, seed, config, strategy).play();
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

  it('still takes a certain win as proven in a game with no chance', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const move = await botFor(InstantWinGame, 'instant', { debug: true }).play();
      expect(move!.args.option).toBe('win');
      expect(log).toHaveBeenCalledWith('[MCTS] Selecting proven win!');
    } finally {
      log.mockRestore();
    }
  });

  it('weighs a hidden die across sampled worlds, not by the first world it saw', async () => {
    const seeds = Array.from({ length: 60 }, (_, i) => `hidden-${i}`);
    const strategy: BotStrategy = { ...lowStrategy, determinize: rollDie };
    expect(await picks(HiddenDieGame, { useRAVE: false }, seeds, strategy)).toEqual(seeds.map(() => 'safe'));
  });
});

describe('RAVE blend', () => {
  it('keeps exploring a move whose first roll was unlucky (#732)', async () => {
    const seeds = Array.from({ length: 60 }, (_, i) => `dice-${i}`);
    expect(await picks(DiceGame, { useRAVE: true, usePNS: false }, seeds)).toEqual(seeds.map(() => 'safe'));
  });
});
