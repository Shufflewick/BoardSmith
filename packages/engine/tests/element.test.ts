import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  GameElement,
  ElementCollection,
  Player,
} from '../src/index.js';

// Test classes
class TestGame extends Game<TestGame, Player> {}

class Card extends Piece<TestGame> {
  suit!: string;
  rank!: string;
  value!: number;
}

class Deck extends Space<TestGame> {}
class Hand extends Space<TestGame> {}
class DiscardPile extends Space<TestGame> {}

describe('Element Tree', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
  });

  describe('Game creation', () => {
    it('should create a game with players', () => {
      expect(game.players.length).toBe(2);
      expect(game.players[0].position).toBe(0);
      expect(game.players[1].position).toBe(1);
    });

    it('should have a pile for removed elements', () => {
      expect(game.pile).toBeDefined();
    });

    it('should start in setup phase', () => {
      expect(game.phase).toBe('setup');
    });

    it('should allow custom player names', () => {
      const namedGame = new TestGame({
        playerCount: 2,
        playerNames: ['Alice', 'Bob'],
      });
      expect(namedGame.players[0].name).toBe('Alice');
      expect(namedGame.players[1].name).toBe('Bob');
    });
  });

  describe('Element creation', () => {
    it('should create child elements', () => {
      const deck = game.create(Deck, 'deck');
      expect(deck.name).toBe('deck');
      expect(deck.parent).toBe(game);
      expect(game.children.length).toBe(1);
    });

    it('should assign unique IDs', () => {
      const deck = game.create(Deck, 'deck');
      const hand = game.create(Hand, 'hand');
      expect(deck.id).not.toBe(hand.id);
    });

    it('should create multiple elements', () => {
      const deck = game.create(Deck, 'deck');
      deck.createMany(5, Card, 'card', (i) => ({
        suit: 'H',
        rank: String(i + 1),
        value: i + 1,
      }));
      expect(deck.children.length).toBe(5);
    });

    it('should set attributes on creation', () => {
      const deck = game.create(Deck, 'deck');
      const card = deck.create(Card, 'ace', { suit: 'S', rank: 'A', value: 14 });
      expect(card.suit).toBe('S');
      expect(card.rank).toBe('A');
      expect(card.value).toBe(14);
    });
  });

  describe('Tree navigation', () => {
    it('should get branch path', () => {
      const deck = game.create(Deck, 'deck');
      const card1 = deck.create(Card, 'card1', { suit: 'H', rank: '2', value: 2 });
      const card2 = deck.create(Card, 'card2', { suit: 'H', rank: '3', value: 3 });

      expect(deck.branch()).toBe('0');
      expect(card1.branch()).toBe('0/0');
      expect(card2.branch()).toBe('0/1');
    });

    it('should find element by branch', () => {
      const deck = game.create(Deck, 'deck');
      const card = deck.create(Card, 'card', { suit: 'H', rank: '2', value: 2 });

      const found = game.atBranch('0/0');
      expect(found).toBe(card);
    });

    it('should find element by ID', () => {
      const deck = game.create(Deck, 'deck');
      const card = deck.create(Card, 'card', { suit: 'H', rank: '2', value: 2 });

      const found = game.atId(card.id);
      expect(found).toBe(card);
    });
  });
});

describe('Queries', () => {
  let game: TestGame;
  let deck: Deck;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    deck = game.create(Deck, 'deck');

    // Create some cards
    const suits = ['H', 'D', 'C', 'S'];
    const ranks = ['A', '2', '3', '4', '5'];
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.create(Card, `${rank}${suit}`, {
          suit,
          rank,
          value: rank === 'A' ? 14 : parseInt(rank),
        });
      }
    }
  });

  describe('all()', () => {
    it('should find all elements of a class', () => {
      const cards = game.all(Card);
      expect(cards.length).toBe(20);
    });

    it('should filter by name', () => {
      const aces = game.all(Card, 'AH');
      expect(aces.length).toBe(1);
      expect(aces[0].rank).toBe('A');
    });

    it('should filter by properties', () => {
      const hearts = game.all(Card, { suit: 'H' });
      expect(hearts.length).toBe(5);
    });

    it('should filter by predicate', () => {
      const highCards = game.all(Card, (c) => c.value >= 5);
      expect(highCards.length).toBe(8); // 5s (4) + Aces with value 14 (4)
    });

    it('should combine filters', () => {
      const highHearts = game.all(Card, { suit: 'H' }, (c) => c.value >= 4);
      expect(highHearts.length).toBe(3); // 4H, 5H, AH (value 14)
    });
  });

  describe('first() / last()', () => {
    it('should find first matching element', () => {
      const card = game.first(Card, { suit: 'H' });
      expect(card?.suit).toBe('H');
    });

    it('should find last matching element', () => {
      const card = game.last(Card, { suit: 'S' });
      expect(card?.suit).toBe('S');
    });

    it('should return undefined if no match', () => {
      const card = game.first(Card, { suit: 'X' });
      expect(card).toBeUndefined();
    });
  });

  describe('firstN() / lastN()', () => {
    it('should find first N elements', () => {
      const cards = game.firstN(3, Card);
      expect(cards.length).toBe(3);
    });

    it('should find last N elements', () => {
      const cards = game.lastN(3, Card);
      expect(cards.length).toBe(3);
    });
  });

  describe('has() / count()', () => {
    it('should check if elements exist', () => {
      expect(game.has(Card, { suit: 'H' })).toBe(true);
      expect(game.has(Card, { suit: 'X' })).toBe(false);
    });

    it('should count matching elements', () => {
      expect(game.count(Card, { suit: 'H' })).toBe(5);
    });
  });
});

describe('ElementCollection', () => {
  let game: TestGame;
  let deck: Deck;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    deck = game.create(Deck, 'deck');

    deck.createMany(5, Card, 'card', (i) => ({
      suit: 'H',
      rank: String(i + 1),
      value: i + 1,
    }));
  });

  it('should sort by property', () => {
    const sorted = game.all(Card).sortBy('value', 'desc');
    expect(sorted[0].value).toBe(5);
    expect(sorted[4].value).toBe(1);
  });

  it('should calculate sum', () => {
    const sum = game.all(Card).sum('value');
    expect(sum).toBe(15); // 1+2+3+4+5
  });

  it('should find min/max', () => {
    const cards = game.all(Card);
    expect(cards.min('value')?.value).toBe(1);
    expect(cards.max('value')?.value).toBe(5);
  });

  it('should get unique values', () => {
    const suits = game.all(Card).unique('suit');
    expect(suits).toEqual(['H']);
  });

  it('should shuffle with seeded random', () => {
    const cards = game.all(Card);
    const originalOrder = cards.map(c => c.value);
    cards.shuffle(game.random);
    const newOrder = cards.map(c => c.value);
    // With same seed, shuffle should be deterministic
    expect(newOrder).not.toEqual(originalOrder);
  });
});

describe('Piece Movement', () => {
  let game: TestGame;
  let deck: Deck;
  let hand: Hand;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    deck = game.create(Deck, 'deck');
    hand = game.create(Hand, 'hand');

    deck.createMany(5, Card, 'card', (i) => ({
      suit: 'H',
      rank: String(i + 1),
      value: i + 1,
    }));
  });

  it('should move piece between spaces', () => {
    const card = deck.first(Card)!;
    expect(deck.count(Card)).toBe(5);
    expect(hand.count(Card)).toBe(0);

    card.putInto(hand);

    expect(deck.count(Card)).toBe(4);
    expect(hand.count(Card)).toBe(1);
    expect(card.parent).toBe(hand);
  });

  it('should respect stacking order', () => {
    hand.setOrder('stacking');

    const card1 = deck.first(Card)!;
    const card2 = deck.last(Card)!;

    card1.putInto(hand);
    card2.putInto(hand);

    // With stacking, card2 should be first (most recently added)
    expect(hand.first(Card)).toBe(card2);
  });

  it('should remove piece to pile', () => {
    const card = deck.first(Card)!;
    card.remove();

    expect(deck.count(Card)).toBe(4);
    expect(game.pile.count(Card)).toBe(1);
  });
});

describe('Visibility', () => {
  let game: TestGame;
  let hand: Hand;
  let card: Card;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    hand = game.create(Hand, 'hand');
    hand.player = game.players[0];
    card = hand.create(Card, 'card', { suit: 'H', rank: 'A', value: 14 });
  });

  it('should show piece to all by default', () => {
    expect(card.isVisibleTo(0)).toBe(true);
    expect(card.isVisibleTo(1)).toBe(true);
  });

  it('should hide piece from all', () => {
    card.hideFromAll();
    expect(card.isVisibleTo(0)).toBe(false);
    expect(card.isVisibleTo(1)).toBe(false);
  });

  it('should show only to specific player', () => {
    card.showOnlyTo(0);
    expect(card.isVisibleTo(0)).toBe(true);
    expect(card.isVisibleTo(1)).toBe(false);
  });

  it('should hide from specific player', () => {
    card.hideFrom(1);
    expect(card.isVisibleTo(0)).toBe(true);
    expect(card.isVisibleTo(1)).toBe(false);
  });

  it('should apply space visibility rules on enter', () => {
    hand.contentsVisibleToOwner();

    const newCard = hand.create(Card, 'newCard', { suit: 'S', rank: 'K', value: 13 });

    expect(newCard.isVisibleTo(0)).toBe(true); // Owner
    expect(newCard.isVisibleTo(1)).toBe(false); // Not owner
  });
});

describe('ID System', () => {
  let game: TestGame;
  let deck: Deck;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    deck = game.create(Deck, 'deck');
    deck.createMany(5, Card, 'card', (i) => ({
      suit: 'H',
      rank: String(i + 1),
      value: i + 1,
    }));
  });

  it('should assign unique IDs to elements', () => {
    const cards = deck.all(Card);
    const ids = cards.map(c => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should preserve IDs on shuffle', () => {
    const cards = deck.all(Card);
    const originalIds = cards.map(c => c.id);

    deck.shuffle();

    const newIds = deck.all(Card).map(c => c.id);
    // IDs should be same set, maybe different order
    expect(new Set(newIds)).toEqual(new Set(originalIds));
  });

  it('should find by ID after shuffle', () => {
    const card = deck.first(Card)!;
    const cardId = card.id;

    deck.shuffle();

    const found = game.atId(cardId);
    expect(found).toBe(card);
  });

  it('should find by ID via getElementById', () => {
    const card = deck.first(Card)!;
    const cardId = card.id;

    const found = game.getElementById(cardId);
    expect(found).toBe(card);
  });
});

describe('Serialization', () => {
  let game: TestGame;
  let deck: Deck;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    deck = game.create(Deck, 'deck');
    deck.createMany(3, Card, 'card', (i) => ({
      suit: 'H',
      rank: String(i + 1),
      value: i + 1,
    }));
  });

  it('should serialize game to JSON', () => {
    const json = game.toJSON();

    expect(json.className).toBe('TestGame');
    expect(json.players.length).toBe(2);
    expect(json.phase).toBe('setup');
    expect(json.children?.length).toBe(1); // deck
  });

  it('should serialize elements with attributes', () => {
    const json = game.toJSON();
    const deckJson = json.children![0];
    const cardJson = deckJson.children![0];

    expect(cardJson.className).toBe('Card');
    expect(cardJson.attributes.suit).toBe('H');
    expect(cardJson.attributes.rank).toBe('1');
  });

  it('should serialize per-player view', () => {
    const hand = game.create(Hand, 'hand');
    hand.player = game.players[0];
    hand.contentsVisibleToOwner();

    const card = hand.create(Card, 'secret', { suit: 'S', rank: 'A', value: 14 });

    const player0View = game.toJSONForPlayer(0);
    const player1View = game.toJSONForPlayer(1);

    // Player 0 should see the card
    const hand0 = player0View.children?.find(c => c.name === 'hand');
    const card0 = hand0?.children?.[0];
    expect(card0?.attributes.__hidden).toBeUndefined();

    // Player 1 should see hidden placeholder
    const hand1 = player1View.children?.find(c => c.name === 'hand');
    const card1 = hand1?.children?.[0];
    expect(card1?.attributes.__hidden).toBe(true);
  });
});

describe('Player', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 3, playerNames: ['Alice', 'Bob', 'Charlie'] });
  });

  it('should track current player', () => {
    expect(game.players.current).toBe(game.players[0]);
    expect(game.players[0].isCurrent()).toBe(true);

    game.players.setCurrent(1);
    expect(game.players.current).toBe(game.players[1]);
    expect(game.players[0].isCurrent()).toBe(false);
    expect(game.players[1].isCurrent()).toBe(true);
  });

  it('should get next/previous player', () => {
    expect(game.players.next(game.players[0])).toBe(game.players[1]);
    expect(game.players.next(game.players[2])).toBe(game.players[0]); // Wrap around

    expect(game.players.previous(game.players[1])).toBe(game.players[0]);
    expect(game.players.previous(game.players[0])).toBe(game.players[2]); // Wrap around
  });

  it('should get other players', () => {
    const others = game.players.others(game.players[0]);
    expect(others.length).toBe(2);
    expect(others).not.toContain(game.players[0]);
  });

  it('should find player elements with my()', () => {
    const hand = game.create(Hand, 'hand');
    hand.player = game.players[0];
    const card = hand.create(Card, 'card', { suit: 'H', rank: 'A', value: 14 });

    const found = game.players[0].my(Hand);
    expect(found).toBe(hand);
  });

  it('should query mine with player context', () => {
    const hand1 = game.create(Hand, 'p1hand');
    hand1.player = game.players[0];
    hand1.create(Card, 'card1', { suit: 'H', rank: 'A', value: 14 });

    const hand2 = game.create(Hand, 'p2hand');
    hand2.player = game.players[1];
    hand2.create(Card, 'card2', { suit: 'S', rank: 'K', value: 13 });

    game.setPlayerContext(game.players[0]);
    const myHand = game.first(Hand, { mine: true });
    expect(myHand).toBe(hand1);
  });
});
