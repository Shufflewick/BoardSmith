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
  computeDiff,
} from '../src/snapshot.js';

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
    for (const player of game.players) {
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
      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.state).toBeDefined();
      expect(snapshot.state.players).toHaveLength(2);
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
    it('should create a view for player 0', () => {
      const view = createPlayerView(game, 0);

      expect(view.player).toBe(0);
      expect(view.phase).toBe('setup');
      expect(view.complete).toBe(false);
      expect(view.state).toBeDefined();
    });

    it('should show player their own cards', () => {
      const view = createPlayerView(game, 0);

      // Find the player's hand in the view
      const handJson = view.state.children?.find(c => c.name === 'hand-0');
      expect(handJson).toBeDefined();

      // Cards should be visible (not hidden)
      if (handJson?.children) {
        for (const cardJson of handJson.children) {
          expect(cardJson.attributes.__hidden).toBeUndefined();
        }
      }
    });

    it('should hide opponent cards from player', () => {
      const view = createPlayerView(game, 0);

      // Find the opponent's hand in the view
      const opponentHand = view.state.children?.find(c => c.name === 'hand-1');
      expect(opponentHand).toBeDefined();

      // Cards should be hidden
      if (opponentHand?.children) {
        for (const cardJson of opponentHand.children) {
          expect(cardJson.attributes.__hidden).toBe(true);
        }
      }
    });

    it('should hide deck cards from all players', () => {
      const view0 = createPlayerView(game, 0);
      const view1 = createPlayerView(game, 1);

      const deckInView0 = view0.state.children?.find(c => c.name === 'deck');
      const deckInView1 = view1.state.children?.find(c => c.name === 'deck');

      // Both players should see deck cards as hidden
      for (const deckView of [deckInView0, deckInView1]) {
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
      expect(views[0].player).toBe(0);
      expect(views[1].player).toBe(1);
    });
  });

  describe('computeDiff', () => {
    it('should detect new actions in diff', () => {
      // Create mock snapshots directly
      const snapshot1: any = {
        state: { id: 1, className: 'Game', attributes: {}, children: [] },
        commandHistory: [],
        actionHistory: [],
      };
      const snapshot2: any = {
        state: { id: 1, className: 'Game', attributes: {}, children: [] },
        commandHistory: [],
        actionHistory: [{ name: 'test', player: 0, args: {}, timestamp: Date.now() }],
      };

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.newActions).toHaveLength(1);
    });

    it('should detect new commands in diff', () => {
      const snapshot1: any = {
        state: { id: 1, className: 'Game', attributes: {}, children: [] },
        commandHistory: [{ type: 'MESSAGE', text: 'first' }],
        actionHistory: [],
      };
      const snapshot2: any = {
        state: { id: 1, className: 'Game', attributes: {}, children: [] },
        commandHistory: [
          { type: 'MESSAGE', text: 'first' },
          { type: 'MESSAGE', text: 'second' },
        ],
        actionHistory: [],
      };

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.newCommands).toHaveLength(1);
      expect((diff.newCommands[0] as any).text).toBe('second');
    });

    it('should detect added elements', () => {
      const snapshot1: any = {
        state: {
          id: 1, className: 'Game', attributes: {},
          children: [{ id: 2, className: 'Card', attributes: {} }],
        },
        commandHistory: [],
        actionHistory: [],
      };
      const snapshot2: any = {
        state: {
          id: 1, className: 'Game', attributes: {},
          children: [
            { id: 2, className: 'Card', attributes: {} },
            { id: 3, className: 'Card', attributes: {} },
          ],
        },
        commandHistory: [],
        actionHistory: [],
      };

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.added).toContain(3);
    });

    it('should detect removed elements', () => {
      const snapshot1: any = {
        state: {
          id: 1, className: 'Game', attributes: {},
          children: [
            { id: 2, className: 'Card', attributes: {} },
            { id: 3, className: 'Card', attributes: {} },
          ],
        },
        commandHistory: [],
        actionHistory: [],
      };
      const snapshot2: any = {
        state: {
          id: 1, className: 'Game', attributes: {},
          children: [{ id: 2, className: 'Card', attributes: {} }],
        },
        commandHistory: [],
        actionHistory: [],
      };

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.removed).toContain(3);
    });

    it('should detect changed elements', () => {
      const snapshot1: any = {
        state: {
          id: 1, className: 'Game', attributes: {},
          children: [{ id: 2, className: 'Card', attributes: { value: 1 } }],
        },
        commandHistory: [],
        actionHistory: [],
      };
      const snapshot2: any = {
        state: {
          id: 1, className: 'Game', attributes: {},
          children: [{ id: 2, className: 'Card', attributes: { value: 2 } }],
        },
        commandHistory: [],
        actionHistory: [],
      };

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.changed.has(2)).toBe(true);
    });
  });
});
