/**
 * When a card's placeholder is reissued (#715): whenever a card enters or
 * leaves a pile some seat cannot see into, every card in that pile gets a new
 * one, so neither where it went in nor which one left can be read from the ids
 * that stayed; a pile nothing entered or left keeps its ids. And the token
 * behind a placeholder never reaches a seat's view.
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
    for (const name of ['AS', 'KH', 'QD', 'JC']) deck.create(Card, name);
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
  const deck = game.first(Space, 'deck')!;
  deck.shuffle();
  return {
    game,
    deck,
    hand: (seat: number) => game.first(Space, `hand-${seat}`)!,
    table: game.first(Space, 'table')!,
  };
}

/** The ids seat 2 knows `pile`'s cards by, in pile order. */
const idsFor2 = (pile: Space<PileGame>) => pile.all(Card).map((card) => seatIdOf(card, 2));

describe('every card in a hidden pile is reissued when one enters or leaves it (#715)', () => {
  it('leaves no id a seat could read the insert position of a card put into a hidden deck from', () => {
    const { game, deck, hand } = setup();
    const card = game.first(Card, 'AS')!;
    card.putInto(hand(1));
    const known = new Set([...idsFor2(deck), seatIdOf(card, 2)]);

    card.putInto(deck, { position: 'first' });

    const after = idsFor2(deck);
    expect(after).toHaveLength(4);
    expect(after.every((id) => id < 0 && !known.has(id))).toBe(true);
  });

  it('reissues the cards left in a hidden hand when one leaves it, so none says which left', () => {
    const { game, hand, table } = setup();
    for (const name of ['AS', 'KH', 'QD']) game.first(Card, name)!.putInto(hand(1));
    const before = idsFor2(hand(1));

    game.first(Card, 'KH')!.putInto(table);

    const after = idsFor2(hand(1));
    expect(after).toHaveLength(2);
    expect(after.filter((id) => before.includes(id))).toEqual([]);
  });

  it('reissues every card dealt from a shuffled collection into a hidden hand', () => {
    const { game, deck, hand } = setup();
    const before = new Set(idsFor2(deck));

    for (const card of deck.all(Card).shuffle(game.random)) card.putInto(hand(1));

    expect(idsFor2(hand(1)).filter((id) => before.has(id))).toEqual([]);
  });

  it('reissues the whole pile when a card is moved within it, since the ids are sent in pile order', () => {
    const { game, deck } = setup();
    const before = idsFor2(deck);

    game.first(Card, 'AS')!.putInto(deck, { position: 'last' });

    expect(idsFor2(deck).filter((id) => before.includes(id))).toEqual([]);
  });

  it('keeps the ids of a pile nothing entered or left while cards move elsewhere', () => {
    const { game, hand, table } = setup();
    const card = game.first(Card, 'AS')!;
    card.putInto(hand(1));
    const handBefore = idsFor2(hand(1));

    game.first(Card, 'KH')!.putInto(table);
    game.first(Card, 'QD')!.putInto(hand(2));

    expect(idsFor2(hand(1))).toEqual(handBefore);
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
