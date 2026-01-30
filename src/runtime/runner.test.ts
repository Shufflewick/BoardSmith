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
  type FlowContext,
} from '../engine/index.js';
import { GameRunner } from './runner.js';

// Test game classes
class TestGame extends Game<TestGame, Player> {
  deck!: Deck;
  hands!: Hand[];

  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);

    // Register classes
    this.registerElements([Card, Hand, Deck]);

    // Create deck
    this.deck = this.create(Deck, 'deck');
    this.deck.contentsHidden();

    // Create hands for each player
    this.hands = [];
    for (const player of this.all(Player)) {
      const hand = this.create(Hand, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      this.hands.push(hand);
    }

    // Create cards
    for (let i = 0; i < 20; i++) {
      this.deck.create(Card, `card-${i}`, { suit: 'H', rank: String((i % 13) + 1) });
    }

    // Deal cards
    for (let i = 0; i < 3; i++) {
      for (const hand of this.hands) {
        const card = this.deck.first(Card);
        if (card) card.putInto(hand);
      }
    }

    // Register draw action
    const drawAction = Action.create('draw')
      .prompt('Draw a card')
      .condition({
        'deck has cards': () => this.deck.count(Card) > 0,
      })
      .execute((args, ctx) => {
        const card = this.deck.first(Card);
        if (card) {
          // player.seat is 1-indexed, hands array is 0-indexed
          const hand = this.hands[ctx.player.seat - 1];
          card.putInto(hand);
          ctx.game.message(`${ctx.player.name} drew a card`);
        }
        return { success: true };
      });

    const passAction = Action.create('pass')
      .prompt('Pass turn')
      .execute((args, ctx) => {
        ctx.game.message(`${ctx.player.name} passed`);
        return { success: true };
      });

    this.registerActions(drawAction, passAction);

    // Set up flow
    const gameFlow = defineFlow({
      root: loop({
        while: (ctx: FlowContext) => (ctx.get<number>('round') ?? 1) <= 2,
        maxIterations: 10,
        do: eachPlayer({
          do: actionStep({
            actions: ['draw', 'pass'],
          }),
        }),
      }),
      setup: (ctx) => ctx.set('round', 1),
    });
    this.setFlow(gameFlow);
  }
}

class Card extends Piece<TestGame> {
  suit!: string;
  rank!: string;
}

class Hand extends Space<TestGame> {}
class Deck extends Space<TestGame> {}

describe('GameRunner', () => {
  describe('creation', () => {
    it('should create a game runner', () => {
      const runner = new GameRunner({
        GameClass: TestGame,
        gameType: 'test-game',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'] },
      });

      expect(runner.game).toBeDefined();
      expect(runner.gameType).toBe('test-game');
      expect(runner.actionHistory).toEqual([]);
    });
  });

  describe('game flow', () => {
    let runner: GameRunner<TestGame>;

    beforeEach(() => {
      runner = new GameRunner({
        GameClass: TestGame,
        gameType: 'test-game',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'test' },
      });
    });

    it('should start the game flow', () => {
      const state = runner.start();

      expect(state.awaitingInput).toBe(true);
      expect(state.currentPlayer).toBe(1);
      expect(state.availableActions).toContain('draw');
      expect(state.availableActions).toContain('pass');
    });

    it('should perform an action and record it', () => {
      runner.start();

      const result = runner.performAction('draw', 1, {});

      expect(result.success).toBe(true);
      expect(result.serializedAction).toBeDefined();
      expect(result.serializedAction?.name).toBe('draw');
      expect(result.serializedAction?.player).toBe(1);
      expect(runner.actionHistory).toHaveLength(1);
    });

    it('should reject action from wrong player', () => {
      runner.start();

      // Player 2 tries to act when it's player 1's turn
      const result = runner.performAction('draw', 2, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('turn');
    });

    it('should provide player views after action', () => {
      runner.start();

      const result = runner.performAction('draw', 1, {});

      expect(result.playerViews).toBeDefined();
      expect(result.playerViews).toHaveLength(2);
    });
  });

  describe('snapshots', () => {
    let runner: GameRunner<TestGame>;

    beforeEach(() => {
      runner = new GameRunner({
        GameClass: TestGame,
        gameType: 'test-game',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'test' },
      });
      runner.start();
    });

    it('should create a snapshot', () => {
      runner.performAction('draw', 1, {});

      const snapshot = runner.getSnapshot();

      expect(snapshot.gameType).toBe('test-game');
      expect(snapshot.actionHistory).toHaveLength(1);
      expect(snapshot.seed).toBe('test');
    });

    it('should get player views', () => {
      const view = runner.getPlayerView(1);

      expect(view.player).toBe(1);
      expect(view.flowState?.isMyTurn).toBe(true);
    });

    it('should get all player views', () => {
      const views = runner.getAllPlayerViews();

      expect(views).toHaveLength(2);
      expect(views[0].flowState?.isMyTurn).toBe(true);
      expect(views[1].flowState?.isMyTurn).toBe(false);
    });
  });

  describe('replay', () => {
    it('should replay actions to recreate game state', () => {
      // Play a game
      const runner1 = new GameRunner({
        GameClass: TestGame,
        gameType: 'test-game',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'replay-test' },
      });
      runner1.start();
      runner1.performAction('draw', 1, {}); // Player 1 draws
      runner1.performAction('pass', 2, {}); // Player 2 passes (it's now their turn)

      // Replay it
      const runner2 = GameRunner.replay(
        {
          GameClass: TestGame,
          gameType: 'test-game',
          gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'replay-test' },
        },
        runner1.actionHistory
      );

      // Should have same state
      expect(runner2.actionHistory).toHaveLength(2);

      // Cards should be in same positions (deterministic with seed)
      const hand1_1 = runner1.game.hands[0].count(Card); // hands is a regular array, keep 0-indexed
      const hand1_2 = runner2.game.hands[0].count(Card);
      expect(hand1_2).toBe(hand1_1);
    });
  });
});
