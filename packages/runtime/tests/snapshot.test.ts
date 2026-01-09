import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
} from '@boardsmith/engine';
import {
  createSnapshot,
  createPlayerView,
  createAllPlayerViews,
} from '../src/index.js';

// Test game classes
class TestGame extends Game<TestGame, Player> {}

class Card extends Piece<TestGame> {
  suit!: string;
  rank!: string;
}

class Hand extends Space<TestGame> {}
class Deck extends Space<TestGame> {}

describe('GameStateSnapshot', () => {
  let game: TestGame;
  let deck: Deck;
  let hands: Hand[];

  beforeEach(() => {
    game = new TestGame({ playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'test' });

    deck = game.create(Deck, 'deck');
    deck.contentsHidden();

    hands = [];
    for (const player of game.all(Player)) {
      const hand = game.create(Hand, `hand-${player.position}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      hands.push(hand);
    }

    // Create some cards
    for (let i = 0; i < 10; i++) {
      deck.create(Card, `card-${i}`, { suit: 'H', rank: String(i + 1) });
    }

    // Deal 3 cards to each player
    for (let i = 0; i < 3; i++) {
      for (const hand of hands) {
        const card = deck.first(Card);
        if (card) card.putInto(hand);
      }
    }
  });

  describe('createSnapshot', () => {
    it('should create a complete snapshot', () => {
      const snapshot = createSnapshot(game, 'test-game', [], 'test');

      expect(snapshot.version).toBe(1);
      expect(snapshot.gameType).toBe('test-game');
      expect(snapshot.seed).toBe('test');
      expect(snapshot.state).toBeDefined();
      // Players are now children of the game element tree
      const playerChildren = snapshot.state.children?.filter((c: any) => c.className === 'Player') ?? [];
      expect(playerChildren.length).toBe(2);
      expect(snapshot.commandHistory).toBeDefined();
      expect(snapshot.actionHistory).toEqual([]);
    });

    it('should include action history', () => {
      const actions = [
        { name: 'test', player: 0, args: {}, timestamp: Date.now() },
      ];
      const snapshot = createSnapshot(game, 'test-game', actions);

      expect(snapshot.actionHistory).toHaveLength(1);
      expect(snapshot.actionHistory[0].name).toBe('test');
    });
  });

  describe('createPlayerView', () => {
    it('should create a view for player 1', () => {
      const view = createPlayerView(game, 1);  // 1-indexed

      expect(view.player).toBe(1);
      expect(view.phase).toBe('setup');
      expect(view.complete).toBe(false);
      expect(view.state).toBeDefined();
    });

    it('should show player their own cards', () => {
      const view = createPlayerView(game, 1);  // 1-indexed

      // Find the player's hand in the view (hand-1 for player at position 1)
      const handJson = view.state.children?.find(c => c.name === 'hand-1');
      expect(handJson).toBeDefined();

      // Cards should be visible (not hidden)
      if (handJson?.children) {
        for (const cardJson of handJson.children) {
          expect(cardJson.attributes.__hidden).toBeUndefined();
        }
      }
    });

    it('should hide opponent cards from player', () => {
      const view = createPlayerView(game, 1);  // 1-indexed

      // Find the opponent's hand in the view (hand-2 for player at position 2)
      const opponentHand = view.state.children?.find(c => c.name === 'hand-2');
      expect(opponentHand).toBeDefined();

      // Cards should be hidden
      if (opponentHand?.children) {
        for (const cardJson of opponentHand.children) {
          expect(cardJson.attributes.__hidden).toBe(true);
        }
      }
    });

    it('should hide deck cards from all players', () => {
      const view1 = createPlayerView(game, 1);  // 1-indexed
      const view2 = createPlayerView(game, 2);

      const deckInView1 = view1.state.children?.find(c => c.name === 'deck');
      const deckInView2 = view2.state.children?.find(c => c.name === 'deck');

      // Both players should see deck cards as hidden
      for (const deckView of [deckInView1, deckInView2]) {
        if (deckView?.children) {
          for (const cardJson of deckView.children) {
            expect(cardJson.attributes.__hidden).toBe(true);
          }
        }
      }
    });
  });

  describe('createAllPlayerViews', () => {
    it('should create views for all players', () => {
      const views = createAllPlayerViews(game);

      expect(views).toHaveLength(2);
      expect(views[0].player).toBe(1);  // 1-indexed
      expect(views[1].player).toBe(2);
    });
  });
});
