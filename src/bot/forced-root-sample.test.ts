/**
 * A root move `threatResponseMoves` forces (`urgent: true`) is searched in
 * every world that allows it, under a sampler too (#1391). The per-world root
 * refresh used to keep only the forced moves found in a random 20-arg sample
 * of each action, so a world whose draw missed them left the root with nothing
 * to choose, and its playout made moves the game had ruled out.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, NotSimulableError, type GameOptions } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { BotMove, BotStrategy } from './types.js';

/** Every pick the search copies made. */
let made: string[] = [];
/** How many options the next game offers. */
let width = 0;
/** Worlds the sampler has drawn, and how the gate rules out `o87` after the first. */
let worlds = 0;
let ruling: 'refuses' | 'cannot judge' | undefined;

const forced = ['o41', 'o87'];

/** One pick from `width` options, and the game is over. */
class WideGame extends Game<WideGame, Player> {
  constructor(gameOptions: GameOptions) {
    super(gameOptions);
    const options = Array.from({ length: width }, (_, i) => `o${i}`);
    this.registerAction(
      Action.create('pick')
        .chooseFrom('option', { prompt: 'Pick', choices: options })
        .validate((args) => {
          if (worlds === 1 || args.option !== 'o87' || !ruling) return true;
          if (ruling === 'refuses') return 'Not in this world.';
          throw new NotSimulableError('This world was never told.');
        })
        .execute((args) => {
          made.push(String(args.option));
        }),
    );
    this.setFlow({ root: actionStep({ actions: ['pick'] }) });
  }
}

const strategy: BotStrategy = {
  determinize: () => {
    worlds++;
  },
  // The game's own list: above the enumeration budget the listing it is handed is a random sample.
  threatResponseMoves: () => ({
    moves: forced.map((option) => ({ action: 'pick', args: { option } })),
    urgent: true,
  }),
};

const iterations = 60;

/** A seeded search of a game with `options` options, whose gate rules out `o87` after the first world as `gate` says. */
async function search(options: number, gate?: typeof ruling): Promise<BotMove | null> {
  width = options;
  ruling = gate;
  worlds = 0;
  const game = new WideGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'wide' });
  game.startFlow();
  const bot = new MCTSBot(game, WideGame, 'wide', 1, { iterations, seed: 's', timeout: Infinity }, strategy);
  made = [];
  return bot.play();
}

describe('a forced root move under a sampler (#1391)', () => {
  it.each([
    ['an action within the enumeration budget', 100],
    ['an action above the enumeration budget (#691)', 12_000],
  ])('is searched in every world, and nothing the game ruled out is made, for %s', async (_label, options) => {
    const move = await search(options);

    expect(made.filter((option) => !forced.includes(option))).toEqual([]);
    expect(made).toHaveLength(iterations);
    expect(forced).toContain(String(move?.args.option));
  });

  it.each(['refuses', 'cannot judge'] as const)('rules out a forced move in a world whose gate %s it', async (gate) => {
    await search(100, gate);

    expect(made.slice(1)).toEqual(Array(iterations - 1).fill('o41'));
  });
});
