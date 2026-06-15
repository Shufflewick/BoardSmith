import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Piece, Player, Deck, Hand } from '../index.js';

// Regression test for audit finding F32: Deck and Hand must be secure-by-default.
// A freshly-created Deck hides its contents (faces AND order) from everyone, and a
// freshly-created Hand reveals its contents only to its owner. Designers can still
// opt into more visibility via the existing override methods.

class TestGame extends Game<TestGame, Player> {}

class Card extends Piece<TestGame> {
  suit!: string;
  rank!: string;
}

function findByName(children: any[] | undefined, name: string): any {
  return children?.find((c) => c.name === name);
}

describe('Deck/Hand secure-by-default visibility (F32)', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
  });

  it('hides a fresh Deck contents from non-owner in per-player snapshot', () => {
    const deck = game.create(Deck, 'draw-pile');
    deck.createMany(3, Card, 'card', (i) => ({ suit: 'H', rank: String(i + 1) }));

    // A deck is a shared draw pile: nobody should see the contents by default.
    const view = game.toJSONForPlayer(2);
    const deckJson = findByName(view.children, 'draw-pile');
    const cards = deckJson?.children ?? [];

    expect(cards.length).toBe(3);
    for (const card of cards) {
      expect(card.attributes.__hidden).toBe(true);
      expect(card.attributes.suit).toBeUndefined();
      expect(card.attributes.rank).toBeUndefined();
    }
  });

  it('reveals a fresh Hand contents only to its owner', () => {
    const hand = game.create(Hand, 'hand-1');
    hand.player = game.getPlayer(1)!;
    hand.createMany(2, Card, 'card', (i) => ({ suit: 'S', rank: String(i + 1) }));

    const ownerView = game.toJSONForPlayer(1);
    const opponentView = game.toJSONForPlayer(2);

    const ownerCards = findByName(ownerView.children, 'hand-1')?.children ?? [];
    const opponentCards = findByName(opponentView.children, 'hand-1')?.children ?? [];

    expect(ownerCards.length).toBe(2);
    for (const card of ownerCards) {
      expect(card.attributes.__hidden).toBeUndefined();
      expect(card.attributes.suit).toBe('S');
    }

    expect(opponentCards.length).toBe(2);
    for (const card of opponentCards) {
      expect(card.attributes.__hidden).toBe(true);
      expect(card.attributes.suit).toBeUndefined();
    }
  });

  it('still lets a designer opt into full visibility via contentsVisible()', () => {
    const deck = game.create(Deck, 'open-pile');
    deck.contentsVisible(); // explicit override after the secure constructor default
    deck.createMany(3, Card, 'card', (i) => ({ suit: 'H', rank: String(i + 1) }));

    const view = game.toJSONForPlayer(2);
    const cards = findByName(view.children, 'open-pile')?.children ?? [];

    expect(cards.length).toBe(3);
    for (const card of cards) {
      expect(card.attributes.__hidden).toBeUndefined();
      expect(card.attributes.suit).toBe('H');
    }
  });
});
