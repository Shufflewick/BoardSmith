import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, type GameOptions } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { BotStrategy } from './types.js';

/** Every pick the search copies made, in order. */
let made: string[] = [];

const options = ['o0', 'o1', 'o2', 'o3', 'o4'];

/** One pick from five options, and the game is over. */
class PickGame extends Game<PickGame, Player> {
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

const preferO3: BotStrategy = {
  threatResponseMoves: () => ({ moves: [{ action: 'pick', args: { option: 'o3' } }], urgent: false }),
  moveOrdering: (_game, _seat, moves) => [...moves].reverse(),
};

describe('threatResponseMoves with urgent: false (#1839)', () => {
  it.each([
    ['without a sampler', preferO3],
    ['under a determinize sampler', { ...preferO3, determinize: () => {} }],
  ])('expands the listed move first and still searches every other root move, %s', async (_label, strategy) => {
    const game = new PickGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'pick' });
    game.startFlow();
    const bot = new MCTSBot(game, PickGame, 'pick', 1, { iterations: 30, seed: 's', timeout: Infinity }, strategy);
    made = [];

    await bot.play();

    expect(made[0]).toBe('o3');
    expect(new Set(made)).toEqual(new Set(options));
  });
});
