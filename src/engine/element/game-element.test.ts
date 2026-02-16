import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  GameElement,
  ElementCollection,
  Player,
} from '../index.js';
import type { ElementJSON, PlayerViewFunction } from '../index.js';

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
      expect(game.all(Player).length).toBe(2);
      expect(game.getPlayer(1)!.seat).toBe(1);
      expect(game.getPlayer(2)!.seat).toBe(2);
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
      expect(namedGame.getPlayer(1)!.name).toBe('Alice');
      expect(namedGame.getPlayer(2)!.name).toBe('Bob');
    });
  });

  describe('Element creation', () => {
    it('should create child elements', () => {
      const deck = game.create(Deck, 'deck');
      expect(deck.name).toBe('deck');
      expect(deck.parent).toBe(game);
      // Players are now children of game, plus the deck
      expect(game.children.length).toBe(3); // 2 players + 1 deck
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

      // With players as children of game (at indices 0, 1), deck is at index 2
      expect(deck.branch()).toBe('2');
      expect(card1.branch()).toBe('2/0');
      expect(card2.branch()).toBe('2/1');
    });

    it('should find element by branch', () => {
      const deck = game.create(Deck, 'deck');
      const card = deck.create(Card, 'card', { suit: 'H', rank: '2', value: 2 });

      // With players as children of game, deck is at index 2
      const found = game.atBranch('2/0');
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

  it('should shuffle with seeded random deterministically', () => {
    const cards = game.all(Card);
    cards.shuffle(game.random);
    const firstShuffle = cards.map(c => c.value);
    // Reshuffle — seeded random is deterministic so sequence is reproducible
    // but the second shuffle applies to already-shuffled order, so result differs
    cards.shuffle(game.random);
    const secondShuffle = cards.map(c => c.value);
    // Both shuffles should produce a result (not throw or no-op)
    expect(firstShuffle).toHaveLength(5);
    expect(secondShuffle).toHaveLength(5);
    // Seeded random produces deterministic sequence — verify it actually shuffles
    // by checking at least one of the two shuffles differs from sorted order
    const sorted = [1, 2, 3, 4, 5];
    const firstDiffers = !firstShuffle.every((v, i) => v === sorted[i]);
    const secondDiffers = !secondShuffle.every((v, i) => v === sorted[i]);
    expect(firstDiffers || secondDiffers).toBe(true);
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
    hand.player = game.getPlayer(1)!;
    card = hand.create(Card, 'card', { suit: 'H', rank: 'A', value: 14 });
  });

  it('should show piece to all by default', () => {
    expect(card.isVisibleTo(1)).toBe(true);
    expect(card.isVisibleTo(2)).toBe(true);
  });

  it('should hide piece from all', () => {
    card.hideFromAll();
    expect(card.isVisibleTo(1)).toBe(false);
    expect(card.isVisibleTo(2)).toBe(false);
  });

  it('should show only to specific player', () => {
    card.showOnlyTo(1);
    expect(card.isVisibleTo(1)).toBe(true);
    expect(card.isVisibleTo(2)).toBe(false);
  });

  it('should hide from specific player', () => {
    card.hideFrom(2);
    expect(card.isVisibleTo(1)).toBe(true);
    expect(card.isVisibleTo(2)).toBe(false);
  });

  it('should apply space visibility rules on enter', () => {
    hand.contentsVisibleToOwner();

    const newCard = hand.create(Card, 'newCard', { suit: 'S', rank: 'K', value: 13 });

    expect(newCard.isVisibleTo(1)).toBe(true); // Owner (player 1)
    expect(newCard.isVisibleTo(2)).toBe(false); // Not owner (player 2)
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
    // Players are now children of the game
    expect(json.children?.filter((c: any) => c.className === 'Player').length).toBe(2);
    expect(json.phase).toBe('setup');
    expect(json.children?.length).toBe(3); // 2 players + 1 deck
  });

  it('should serialize elements with attributes', () => {
    const json = game.toJSON();
    // Deck is the third child (after 2 players)
    const deckJson = json.children![2];
    const cardJson = deckJson.children![0];

    expect(cardJson.className).toBe('Card');
    expect(cardJson.attributes.suit).toBe('H');
    expect(cardJson.attributes.rank).toBe('1');
  });

  it('should serialize per-player view', () => {
    const hand = game.create(Hand, 'hand');
    hand.player = game.getPlayer(1)!;
    hand.contentsVisibleToOwner();

    const card = hand.create(Card, 'secret', { suit: 'S', rank: 'A', value: 14 });

    const player1View = game.toJSONForPlayer(1); // Player 1 is the owner
    const player2View = game.toJSONForPlayer(2); // Player 2 is not the owner

    // Player 1 (owner) should see the card
    const hand1 = player1View.children?.find(c => c.name === 'hand');
    const card1 = hand1?.children?.[0];
    expect(card1?.attributes.__hidden).toBeUndefined();

    // Player 2 (non-owner) should see hidden placeholder
    const hand2 = player2View.children?.find(c => c.name === 'hand');
    const card2 = hand2?.children?.[0];
    expect(card2?.attributes.__hidden).toBe(true);
  });
});

describe('Player', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 3, playerNames: ['Alice', 'Bob', 'Charlie'] });
  });

  it('should track current player', () => {
    expect(game.currentPlayer).toBe(game.getPlayer(1)!);
    expect(game.getPlayer(1)!.isCurrent()).toBe(true);

    game.setCurrentPlayer(2);
    expect(game.currentPlayer).toBe(game.getPlayer(2)!);
    expect(game.getPlayer(1)!.isCurrent()).toBe(false);
    expect(game.getPlayer(2)!.isCurrent()).toBe(true);
  });

  it('should get next/previous player', () => {
    expect(game.nextAfter(game.getPlayer(1)!)).toBe(game.getPlayer(2)!);
    expect(game.nextAfter(game.getPlayer(3)!)).toBe(game.getPlayer(1)!); // Wrap around

    expect(game.previousBefore(game.getPlayer(2)!)).toBe(game.getPlayer(1)!);
    expect(game.previousBefore(game.getPlayer(1)!)).toBe(game.getPlayer(3)!); // Wrap around
  });

  it('should get other players', () => {
    const others = game.others(game.getPlayer(1)!);
    expect(others.length).toBe(2);
    expect(others).not.toContain(game.getPlayer(1)!);
  });

  it('should find player elements with my()', () => {
    const hand = game.create(Hand, 'hand');
    hand.player = game.getPlayer(1)!;
    const card = hand.create(Card, 'card', { suit: 'H', rank: 'A', value: 14 });

    const found = game.getPlayer(1)!.my(Hand);
    expect(found).toBe(hand);
  });

  it('should query mine with player context', () => {
    const hand1 = game.create(Hand, 'p1hand');
    hand1.player = game.getPlayer(1)!;
    hand1.create(Card, 'card1', { suit: 'H', rank: 'A', value: 14 });

    const hand2 = game.create(Hand, 'p2hand');
    hand2.player = game.getPlayer(2)!;
    hand2.create(Card, 'card2', { suit: 'S', rank: 'K', value: 13 });

    game.setPlayerContext(game.getPlayer(1)!);
    const myHand = game.first(Hand, { mine: true });
    expect(myHand).toBe(hand1);
  });
});

describe('playerView Function', () => {
  it('should call playerView after zone-based filtering', () => {
    class GameWithPlayerView extends Game<GameWithPlayerView, Player> {
      static playerView = (state: ElementJSON, _pos: number | null) => ({
        ...state,
        attributes: { ...state.attributes, transformed: true },
      });
    }

    const game = new GameWithPlayerView({ playerCount: 2 });
    const view = game.toJSONForPlayer(0);

    expect(view.attributes?.transformed).toBe(true);
  });

  it('should receive correct player position', () => {
    let receivedPosition: number | null = -999;

    class GameTrackingPosition extends Game<GameTrackingPosition, Player> {
      static playerView = (state: ElementJSON, pos: number | null) => {
        receivedPosition = pos;
        return state;
      };
    }

    const game = new GameTrackingPosition({ playerCount: 3 });

    game.toJSONForPlayer(0);
    expect(receivedPosition).toBe(0);

    game.toJSONForPlayer(2);
    expect(receivedPosition).toBe(2);
  });

  it('should handle spectator (null position)', () => {
    let receivedPosition: number | null = -999;

    class GameWithSpectator extends Game<GameWithSpectator, Player> {
      static playerView = (state: ElementJSON, pos: number | null) => {
        receivedPosition = pos;
        return {
          ...state,
          attributes: { ...state.attributes, isSpectator: pos === null },
        };
      };
    }

    const game = new GameWithSpectator({ playerCount: 2 });
    const view = game.toJSONForPlayer(null);

    expect(receivedPosition).toBe(null);
    expect(view.attributes?.isSpectator).toBe(true);
  });

  it('should strip attributes in playerView', () => {
    class GameWithSecrets extends Game<GameWithSecrets, Player> {
      secretValue = 42;
      publicValue = 'visible';

      static playerView = (state: ElementJSON, _pos: number | null) => ({
        ...state,
        attributes: {
          ...state.attributes,
          secretValue: undefined, // Strip the secret
        },
      });
    }

    const game = new GameWithSecrets({ playerCount: 2 });
    const view = game.toJSONForPlayer(0);

    expect(view.attributes?.publicValue).toBe('visible');
    expect(view.attributes?.secretValue).toBeUndefined();
  });

  it('should not affect games without playerView', () => {
    const game = new TestGame({ playerCount: 2 });
    const deck = game.create(Deck, 'deck');
    deck.createMany(3, Card, 'card', (i) => ({
      suit: 'H',
      rank: String(i + 1),
      value: i + 1,
    }));

    const view = game.toJSONForPlayer(0);

    expect(view.className).toBe('TestGame');
    // 2 players + 1 deck = 3 children
    expect(view.children?.length).toBe(3);
    // Deck is the 3rd child (index 2)
    expect(view.children?.[2].children?.length).toBe(3);
  });
});

describe('Game Restoration', () => {
  // Test class with element references
  class Squad extends Space<TestGame> {
    sectorId?: number;
    linkedSquad?: Squad;
  }

  class RebelPlayer extends Space<TestGame> {
    primarySquad?: Squad;
  }

  class RefTestGame extends Game<RefTestGame, Player> {}

  it('should resolve element references after restoration', () => {
    // Create original game with element references
    const game = new RefTestGame({ playerCount: 2 });
    game._ctx.classRegistry.set('Squad', Squad);
    game._ctx.classRegistry.set('RebelPlayer', RebelPlayer);

    const rebel = game.create(RebelPlayer, 'rebel1');
    const squad1 = game.create(Squad, 'squad1', { sectorId: 5 });
    const squad2 = game.create(Squad, 'squad2', { sectorId: 10 });

    // Set element references
    rebel.primarySquad = squad1;
    squad1.linkedSquad = squad2;

    // Serialize
    const json = game.toJSON();

    // Verify serialization encoded references correctly
    const rebelJson = json.children?.find(c => c.name === 'rebel1');
    // With 2 players as children (indices 0, 1), then rebel (2), squad1 (3), squad2 (4)
    expect(rebelJson?.attributes.primarySquad).toEqual({ __elementRef: '3' }); // squad1 is at index 3

    // Restore game
    const classRegistry = new Map<string, any>();
    classRegistry.set('RefTestGame', RefTestGame);
    classRegistry.set('Squad', Squad);
    classRegistry.set('RebelPlayer', RebelPlayer);

    const restored = Game.restoreGame(json, RefTestGame, classRegistry);

    // Verify references were resolved
    const restoredRebel = restored.first({ name: 'rebel1' }) as RebelPlayer;
    const restoredSquad1 = restored.first({ name: 'squad1' }) as Squad;
    const restoredSquad2 = restored.first({ name: 'squad2' }) as Squad;

    expect(restoredRebel.primarySquad).toBe(restoredSquad1);
    expect(restoredSquad1.linkedSquad).toBe(restoredSquad2);
    expect(restoredSquad1.sectorId).toBe(5);
    expect(restoredSquad2.sectorId).toBe(10);
  });

  it('should resolve nested element references in objects', () => {
    class DataHolder extends Space<TestGame> {
      data?: {
        target?: GameElement;
        nested?: {
          anotherTarget?: GameElement;
        };
      };
    }

    const game = new RefTestGame({ playerCount: 2 });
    game._ctx.classRegistry.set('DataHolder', DataHolder);
    game._ctx.classRegistry.set('Squad', Squad);

    const holder = game.create(DataHolder, 'holder');
    const target1 = game.create(Squad, 'target1');
    const target2 = game.create(Squad, 'target2');

    holder.data = {
      target: target1,
      nested: {
        anotherTarget: target2,
      },
    };

    const json = game.toJSON();
    const classRegistry = new Map<string, any>();
    classRegistry.set('RefTestGame', RefTestGame);
    classRegistry.set('DataHolder', DataHolder);
    classRegistry.set('Squad', Squad);

    const restored = Game.restoreGame(json, RefTestGame, classRegistry);
    const restoredHolder = restored.first({ name: 'holder' }) as DataHolder;
    const restoredTarget1 = restored.first({ name: 'target1' }) as Squad;
    const restoredTarget2 = restored.first({ name: 'target2' }) as Squad;

    expect(restoredHolder.data?.target).toBe(restoredTarget1);
    expect(restoredHolder.data?.nested?.anotherTarget).toBe(restoredTarget2);
  });

  it('should resolve element references in arrays', () => {
    class Container extends Space<TestGame> {
      items?: Squad[];
    }

    const game = new RefTestGame({ playerCount: 2 });
    game._ctx.classRegistry.set('Container', Container);
    game._ctx.classRegistry.set('Squad', Squad);

    const container = game.create(Container, 'container');
    const item1 = game.create(Squad, 'item1');
    const item2 = game.create(Squad, 'item2');

    container.items = [item1, item2];

    const json = game.toJSON();
    const classRegistry = new Map<string, any>();
    classRegistry.set('RefTestGame', RefTestGame);
    classRegistry.set('Container', Container);
    classRegistry.set('Squad', Squad);

    const restored = Game.restoreGame(json, RefTestGame, classRegistry);
    const restoredContainer = restored.first({ name: 'container' }) as Container;
    const restoredItem1 = restored.first({ name: 'item1' }) as Squad;
    const restoredItem2 = restored.first({ name: 'item2' }) as Squad;

    expect(restoredContainer.items).toHaveLength(2);
    expect(restoredContainer.items?.[0]).toBe(restoredItem1);
    expect(restoredContainer.items?.[1]).toBe(restoredItem2);
  });
});

describe('PersistentMap', () => {
  // Test game that uses persistentMap
  class GameWithPersistentMap extends Game<GameWithPersistentMap, Player> {
    // Using persistentMap for HMR-safe state
    pendingLoot = this.persistentMap<string, string[]>('pendingLoot');

    constructor(options: { playerCount: number }) {
      super(options);
    }
  }

  it('should store and retrieve values', () => {
    const game = new GameWithPersistentMap({ playerCount: 2 });

    game.pendingLoot.set('sector1', ['gold', 'silver']);
    game.pendingLoot.set('sector2', ['bronze']);

    expect(game.pendingLoot.get('sector1')).toEqual(['gold', 'silver']);
    expect(game.pendingLoot.get('sector2')).toEqual(['bronze']);
    expect(game.pendingLoot.size).toBe(2);
  });

  it('should persist data in game.settings', () => {
    const game = new GameWithPersistentMap({ playerCount: 2 });

    game.pendingLoot.set('sector1', ['gold']);

    // Data should be stored in settings
    expect(game.settings.pendingLoot).toEqual({ sector1: ['gold'] });
  });

  it('should support Map operations', () => {
    const game = new GameWithPersistentMap({ playerCount: 2 });

    game.pendingLoot.set('a', ['x']);
    game.pendingLoot.set('b', ['y']);

    expect(game.pendingLoot.has('a')).toBe(true);
    expect(game.pendingLoot.has('c')).toBe(false);

    game.pendingLoot.delete('a');
    expect(game.pendingLoot.has('a')).toBe(false);
    expect(game.pendingLoot.size).toBe(1);

    game.pendingLoot.clear();
    expect(game.pendingLoot.size).toBe(0);
  });

  it('should support iteration', () => {
    const game = new GameWithPersistentMap({ playerCount: 2 });

    game.pendingLoot.set('a', ['1']);
    game.pendingLoot.set('b', ['2']);

    const entries: [string, string[]][] = [];
    for (const [key, value] of game.pendingLoot) {
      entries.push([key, value]);
    }

    expect(entries).toHaveLength(2);
    expect(entries.some(([k]) => k === 'a')).toBe(true);
    expect(entries.some(([k]) => k === 'b')).toBe(true);
  });

  it('should survive serialization/deserialization via settings', () => {
    const game = new GameWithPersistentMap({ playerCount: 2 });

    game.pendingLoot.set('sector1', ['gold', 'silver']);

    // Serialize
    const json = game.toJSON();

    // Verify settings contains the data
    expect(json.settings.pendingLoot).toEqual({ sector1: ['gold', 'silver'] });

    // In HMR scenario, a new game is created and settings are restored
    // We simulate this by creating a new game and copying settings
    const newGame = new GameWithPersistentMap({ playerCount: 2 });
    newGame.settings = { ...json.settings };

    // PersistentMap should read from settings
    expect(newGame.pendingLoot.get('sector1')).toEqual(['gold', 'silver']);
  });

  it('should return same instance for same name', () => {
    const game = new GameWithPersistentMap({ playerCount: 2 });

    // Multiple calls with same name should return same instance
    const map1 = game['persistentMap']<string, string>('test');
    const map2 = game['persistentMap']<string, string>('test');

    expect(map1).toBe(map2);
  });
});
