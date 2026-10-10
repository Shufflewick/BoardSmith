/**
 * The game's seeded generator (#483): a 256-bit key taken from the whole seed,
 * so a seed's shuffles cannot be found by searching a small state space, and a
 * state that snapshots, checkpoints and bot search can carry exactly.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Action, Game, Piece, Player, Space, actionStep, loop } from '../index.js';
import { GameRunner } from '../../runtime/runner.js';
import { createHeadlessSession } from '../../session/headless-session.js';

class Card extends Piece<CardGame> {}
class Pile extends Space<CardGame> {}

class CardGame extends Game<CardGame, Player> {
  deck!: Pile;
  constructor(options: ConstructorParameters<typeof Game>[0]) {
    super(options);
    this.deck = this.create(Pile, 'deck');
    for (let i = 0; i < 52; i += 1) this.deck.create(Card, `card-${i}`);
    this.registerActions(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({ root: loop({ maxIterations: 100, do: actionStep({ actions: ['pass'] }) }) });
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

  it('refuses a stored snapshot that carries no random state, rather than dealing from the seed again', () => {
    const runner = new GameRunner({
      GameClass: CardGame,
      gameType: 'card-game',
      gameOptions: { playerCount: 2, seed: 'stored-table' },
    });
    runner.start();
    const { randomState: _dropped, ...stored } = JSON.parse(JSON.stringify(runner.getSnapshot()));
    expect(() => GameRunner.fromSnapshot(stored, CardGame)).toThrow(/no random state/);
  });

});

// A game started without a seed gets one from the cryptographic source, so
// its deal is not a function of Math.random's state (#483).
describe('a game started without a seed (#483)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('deals from a fresh secure seed even when Math.random repeats itself', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const deal = () => {
      const game = new CardGame({ playerCount: 2 });
      game.deck.shuffle();
      return game.order();
    };
    expect(deal()).not.toEqual(deal());
  });

  it('a session started without a seed records a 128-bit seed that Math.random did not choose', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const seedOf = async () => {
      const session = createHeadlessSession(
        { gameClass: CardGame, gameType: 'card-game', minPlayers: 2, maxPlayers: 2 },
        { playerCount: 2, playerNames: ['A', 'B'] },
      );
      await session.start();
      return session.host.snapshot?.seed;
    };
    const first = await seedOf();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(await seedOf()).not.toBe(first);
  });
});
