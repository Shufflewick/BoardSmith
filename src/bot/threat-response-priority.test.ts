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

/** One cell from a 2x2 grid, and the game is over. */
class CellGame extends Game<CellGame, Player> {
  constructor(gameOptions: GameOptions) {
    super(gameOptions);
    this.registerAction(
      Action.create('place')
        .chooseFrom('x', { prompt: 'Column', choices: ['0', '1'] })
        .chooseFrom('y', { prompt: 'Row', choices: ['0', '1'] })
        .execute((args) => {
          made.push(`${args.x},${args.y}`);
        }),
    );
    this.setFlow({ root: actionStep({ actions: ['place'] }) });
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

  it.each([
    ['without a sampler', {}],
    ['under a determinize sampler', { determinize: () => {} }],
  ])('searches a listed move once when the hook writes its args in another order, %s', async (_label, sampler) => {
    const game = new CellGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'cell' });
    game.startFlow();
    const strategy: BotStrategy = {
      ...sampler,
      threatResponseMoves: () => ({ moves: [{ action: 'place', args: { y: '1', x: '0' } }], urgent: false }),
    };
    const bot = new MCTSBot(game, CellGame, 'cell', 1, { iterations: 30, seed: 's', timeout: Infinity }, strategy);
    made = [];

    await bot.play();

    expect(made[0]).toBe('0,1');
    expect(new Set(made.slice(0, 4))).toEqual(new Set(['0,0', '0,1', '1,0', '1,1']));
  });
});
