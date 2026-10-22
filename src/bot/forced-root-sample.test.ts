/**
 * A root move `threatResponseMoves` forces (`urgent: true`) is searched in
 * every world that allows it, under a sampler too (#1391). The per-world root
 * refresh used to keep only the forced moves found in a random 20-arg sample
 * of each action, so a world whose draw missed them left the root with nothing
 * to choose, and its playout made moves the game had ruled out.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, type GameOptions } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { BotStrategy } from './types.js';

/** Every pick the search copies made. */
let made: string[] = [];

const options = Array.from({ length: 100 }, (_, i) => `o${i}`);
const forced = ['o41', 'o87'];

/** One pick from 100 options, and the game is over. */
class WideGame extends Game<WideGame, Player> {
  constructor(gameOptions: GameOptions) {
    super(gameOptions);
    this.registerAction(
      Action.create('pick')
        .chooseFrom('option', { prompt: 'Pick', choices: options })
        .execute((args) => {
          made.push(String(args.option));
        }),
    );
    this.setFlow({ root: actionStep({ actions: ['pick'] }) });
  }
}

const strategy: BotStrategy = {
  determinize: () => {},
  threatResponseMoves: (_game, _seat, moves) => ({
    moves: moves.filter((move) => forced.includes(String(move.args.option))),
    urgent: true,
  }),
};

describe('a forced root move under a sampler (#1391)', () => {
  it('is searched in every world, and nothing the game ruled out is made', async () => {
    const game = new WideGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'wide' });
    game.startFlow();
    const iterations = 60;
    const bot = new MCTSBot(game, WideGame, 'wide', 1, { iterations, seed: 's', timeout: Infinity }, strategy);
    made = [];

    const move = await bot.play();

    expect(made.filter((option) => !forced.includes(option))).toEqual([]);
    expect(made).toHaveLength(iterations);
    expect(forced).toContain(String(move?.args.option));
  });
});
