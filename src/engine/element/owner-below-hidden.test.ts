/**
 * An owner rule below a hidden container (#1209): a seat's view resolves an
 * element's owner only through containers the view carries, so who owns a
 * hidden box changes nothing any seat is sent.
 */
import { describe, it, expect } from 'vitest';
import { Game, Piece, Player, Deck, Space, type ElementJSON, type GameOptions } from '../index.js';

class Card extends Piece<TestGame> {}
class Box extends Space<TestGame> {}
class Chest extends Space<TestGame> {
  static override visibleAttributes = ['label'];
  label = 'chest';
  secret = 'gold';
}
class TestGame extends Game<TestGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Box, Chest]);
  }
}

const SEATS = [1, 2, 3, null] as const;

/** A hidden deck holding a crate owned by seat 1, holding a chest every seat is shown, holding a coin. */
function setup() {
  const game = new TestGame({ playerCount: 3, elementIdKey: '0000000000001209' });
  const deck = game.create(Deck, 'deck');
  deck.contentsHidden();
  const crate = deck.create(Box, 'crate');
  crate.player = game.getPlayer(1)!;
  const chest = crate.create(Chest, 'chest');
  chest.showToAll();
  const coin = chest.create(Card, 'coin');
  return { game, deck, crate, chest, coin };
}

const deckIn = (game: TestGame, seat: number | null): ElementJSON =>
  game.toJSONForPlayer(seat).children!.find((c) => c.name === 'deck')!;

describe('an owner rule below a hidden container (#1209)', () => {
  it("does not show the hidden crate's owner the chest's owner-only contents", () => {
    const { game, chest, coin } = setup();
    chest.contentsVisibleToOwner();

    for (const seat of SEATS) {
      const sent = deckIn(game, seat).children![0]!;
      expect(sent.id).toBe(chest.id);
      expect(sent.children!.map((c) => c.id), `seat ${seat}`).not.toContain(coin.id);
      expect(coin.isVisibleTo(seat ?? -1), `seat ${seat}`).toBe(false);
    }
  });

  it("does not send the hidden crate's owner a card shown only to its owner", () => {
    const { game, crate, coin } = setup();
    const gem = crate.create(Card, 'gem');
    gem.showToOwner();

    for (const seat of SEATS) {
      expect(JSON.stringify(game.toJSONForPlayer(seat)), `seat ${seat}`).not.toContain('gem');
      expect(gem.isVisibleTo(seat ?? -1), `seat ${seat}`).toBe(false);
    }
    expect(coin.isVisibleTo(1)).toBe(false);
  });

  it("does not show the hidden crate's owner the chest's owner-only attributes", () => {
    const { game } = setup();

    for (const seat of SEATS) {
      expect(deckIn(game, seat).children![0]!.attributes, `seat ${seat}`).not.toHaveProperty('secret');
    }
  });

  it('sends every seat the same view whichever seat owns the hidden crate', () => {
    const { game, crate, chest } = setup();
    chest.contentsVisibleToOwner();
    const views = (): unknown[] => SEATS.map((seat) => game.toJSONForPlayer(seat));

    const before = views();
    crate.player = game.getPlayer(2)!;
    expect(views()).toEqual(before);
  });

  it('still shows the owner contents whose owner the view carries: the chest its own, the deck its own', () => {
    const { game, deck, crate, chest, coin } = setup();
    chest.contentsVisibleToOwner();
    deck.player = game.getPlayer(3)!;

    expect(deckIn(game, 3).children![0]!.children!.map((c) => c.id)).toEqual([coin.id]);
    expect(deckIn(game, 3).children![0]!.attributes).toHaveProperty('secret', 'gold');
    expect(coin.isVisibleTo(3)).toBe(true);
    expect(coin.isVisibleTo(1)).toBe(false);

    chest.player = game.getPlayer(1)!;
    expect(deckIn(game, 1).children![0]!.children!.map((c) => c.id)).toEqual([coin.id]);
    expect(coin.isVisibleTo(1)).toBe(true);
    expect(coin.isVisibleTo(3)).toBe(false);
    expect(crate.isVisibleTo(1)).toBe(false);
  });
});
