/**
 * The search rebinds only real elements, not plain choices that carry an id (#873).
 *
 * A `chooseFrom` whose choices are plain `{ id, name }` objects naming spaces
 * had each choice swapped for the space with that id. The engine refused every
 * such move, so the search scored nothing and the bot chose at random.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Space,
  Action,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';

const NAMES = ['north', 'south', 'east', 'west', 'gold', 'hill', 'lake', 'wood'];

/** Seat 1 names a space; naming `gold` wins at once, any other keeps play going. */
class PlainChoiceGame extends Game<PlainChoiceGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    for (const name of NAMES) this.create(Space<PlainChoiceGame>, name);
    this.registerAction(
      Action.create<PlainChoiceGame>('claim')
        .chooseFrom('target', {
          prompt: 'Claim a space',
          choices: (ctx) => [...ctx.game.all(Space)].map((space) => ({ id: space.id, name: space.name })),
        })
        .execute((args, ctx) => {
          if ((args.target as { name: string }).name === 'gold') this.finish([ctx.player]);
          return { success: true };
        }),
    );
    this.setFlow({
      root: loop({ maxIterations: 100, do: eachPlayer({ do: actionStep({ actions: ['claim'] }) }) }),
    });
  }
}

describe('a chooseFrom of plain objects with an id', () => {
  it('is searched as the plain choice it is, so the bot finds the winning claim', async () => {
    const seeds = Array.from({ length: 10 }, (_, i) => `plain-${i}`);
    const picked: string[] = [];
    for (const seed of seeds) {
      const game = new PlainChoiceGame({ playerCount: 2, seed });
      game.startFlow();
      const bot = new MCTSBot(game, PlainChoiceGame, 'plain', 1, [], { async: false, timeout: Infinity, seed, iterations: 50 });
      const move = await bot.play();
      picked.push((move!.args.target as { name: string }).name);
    }
    expect(picked).toEqual(seeds.map(() => 'gold'));
  });
});

describe('an element from another copy of the engine', () => {
  it('is still rebound to the search game, though it fails instanceof', () => {
    const game = new PlainChoiceGame({ playerCount: 2, seed: 'copy' });
    game.startFlow();
    const bot = new MCTSBot(game, PlainChoiceGame, 'plain', 1, [], { async: false, timeout: Infinity, seed: 'copy' });
    const b = bot as any;
    b.searchGame = b.restoreGame(b.captureSnapshot());

    // A game bundling its own engine copy hands over elements of a different class (#873).
    const gold = game.first(Space, 'gold')!;
    const foreign = Object.assign(Object.create(null), { id: gold.id, _t: gold._t });
    const rebound = b.rebindArgs({ target: foreign }).target;
    expect(rebound).toBe(b.searchGame.getElementById(gold.id));
  });
});
