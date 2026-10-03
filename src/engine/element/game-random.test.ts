/**
 * The game's seeded generator (#483): a 256-bit key taken from the whole seed,
 * so a seed's shuffles cannot be found by searching a small state space, and a
 * state that snapshots, checkpoints and bot search can carry exactly.
 */
import { describe, it, expect } from 'vitest';
import { Action, Game, Piece, Player, Space, actionStep, defineFlow, loop } from '../index.js';
import { GameRunner } from '../../runtime/runner.js';

class Card extends Piece<CardGame> {}
class Pile extends Space<CardGame> {}

class CardGame extends Game<CardGame, Player> {
  deck!: Pile;
  constructor(options: ConstructorParameters<typeof Game>[0]) {
    super(options);
    this.deck = this.create(Pile, 'deck');
    for (let i = 0; i < 52; i += 1) this.deck.create(Card, `card-${i}`);
    this.registerActions(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(defineFlow({ root: loop({ maxIterations: 100, do: actionStep({ actions: ['pass'] }) }) }));
  }
  order(): Array<string | undefined> {
    return this.deck.all(Card).map((card) => card.name);
  }
}

const shuffled = (seed: string): Array<string | undefined> => {
  const game = new CardGame({ playerCount: 2, seed });
  game.deck.shuffle();
  return game.order();
};

describe('the game generator (#483)', () => {
  it('deals the same order for the same seed', () => {
    expect(shuffled('table-seed')).toEqual(shuffled('table-seed'));
  });

  // These two seeds folded to the same 32-bit number under the old generator,
  // so they dealt the same game.
  it('deals different orders for seeds the old 32-bit fold made identical', () => {
    const prefix = 'b7e151628aed2a6abf7158809cf4f3';
    expect(shuffled(`${prefix}Aa`)).not.toEqual(shuffled(`${prefix}BB`));
  });

  it('exposes a state that survives JSON and continues the game exactly', () => {
    const live = new CardGame({ playerCount: 2, seed: 'live-table' });
    for (let i = 0; i < 11; i += 1) live.random();
    const saved = JSON.parse(JSON.stringify({ randomState: live.getRandomState() })) as { randomState: string };

    const restored = new CardGame({ playerCount: 2, seed: 'a different table' });
    restored.setRandomState(saved.randomState);

    live.deck.shuffle();
    restored.deck.shuffle();
    expect(restored.order()).toEqual(live.order());
    expect(restored.random()).toBe(live.random());
  });

  it('refuses a numeric state from a game saved before #483', () => {
    const game = new CardGame({ playerCount: 2, seed: 'old-save' });
    expect(() => game.setRandomState(42 as unknown as string))
      .toThrow(/before.*#483.*cannot be continued/s);
  });

  it('a snapshot written to storage and read back restores the same draws', () => {
    const runner = new GameRunner({
      GameClass: CardGame,
      gameType: 'card-game',
      gameOptions: { playerCount: 2, seed: 'stored-table' },
    });
    runner.start();
    for (let i = 0; i < 11; i += 1) runner.game.random();

    const stored = JSON.parse(JSON.stringify(runner.getSnapshot()));
    const restored = GameRunner.fromSnapshot(stored, CardGame);

    runner.game.deck.shuffle();
    restored.game.deck.shuffle();
    expect(restored.game.order()).toEqual(runner.game.order());
  });
});
