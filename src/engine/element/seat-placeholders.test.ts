/**
 * When a card's placeholder is reissued (#715): whenever it moves into a place
 * some seat cannot see into, and when its space is shuffled, but not when it
 * moves within the same hidden pile. And the token behind it never reaches a
 * seat's view.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Space, Card, type GameOptions } from '../index.js';
import { seatIdOf } from './seat-placeholders.js';

/** A card class that withholds attributes from non-owners, which redacts its view by another branch. */
class Secret extends Card<PileGame> {
  static override visibleAttributes = ['suit'];
  suit = 'spades';
}

class PileGame extends Game<PileGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Secret]);
    const deck = this.create(Space, 'deck');
    deck.contentsCountOnly();
    for (const name of ['AS', 'KH', 'QD']) deck.create(Card, name);
    for (const player of this.players) {
      const hand = this.create(Space, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
    }
    this.create(Space, 'table');
  }
}

function setup() {
  const game = new PileGame({ playerCount: 2, seed: 'bs715-reissue' });
  return {
    game,
    deck: game.first(Space, 'deck')!,
    hand: (seat: number) => game.first(Space, `hand-${seat}`)!,
    table: game.first(Space, 'table')!,
  };
}

describe('a placeholder is reissued when its card moves where a seat cannot see (#715)', () => {
  it('reissues a card inserted into a hidden deck at a chosen position', () => {
    const { game, deck, hand } = setup();
    const card = game.first(Card, 'AS')!;
    card.putInto(hand(1));
    const inHand = seatIdOf(card, 2);

    card.putInto(deck, { position: 'last' });

    expect(seatIdOf(card, 2)).toBeLessThan(0);
    expect(seatIdOf(card, 2)).not.toBe(inHand);
  });

  it('reissues every card dealt from a shuffled collection into a hidden hand', () => {
    const { game, deck, hand } = setup();
    const before = new Set(deck.all(Card).map((card) => seatIdOf(card, 2)));

    for (const card of deck.all(Card).shuffle(game.random)) card.putInto(hand(1));

    const after = hand(1).all(Card).map((card) => seatIdOf(card, 2));
    expect(after.filter((id) => before.has(id))).toEqual([]);
  });

  it('keeps the placeholder of a card moved within the same hidden pile', () => {
    const { game, deck } = setup();
    const card = game.first(Card, 'AS')!;
    const before = seatIdOf(card, 2);

    card.putInto(deck, { position: 'last' });

    expect(seatIdOf(card, 2)).toBe(before);
  });
});

describe('a placeholder token never reaches a seat (#715)', () => {
  it('is in the saved state and in no seat view, an attribute-whitelisted card included', () => {
    const { game, deck, table } = setup();
    // Shuffled where every seat sees it, so seat 2 is sent it whole, through the whitelist.
    table.create(Secret, 'secret', { player: game.getPlayer(1)! });
    deck.shuffle();
    table.shuffle();

    expect(JSON.stringify(game.toJSON())).toContain('placeholderToken');
    for (const seat of [1, 2, null]) {
      expect(JSON.stringify(game.toJSONForPlayer(seat)), `seat ${seat}`).not.toContain('placeholderToken');
    }
    for (const view of game.toJSONForPlayers([1, 2, null])) {
      expect(JSON.stringify(view)).not.toContain('placeholderToken');
    }
  });
});
