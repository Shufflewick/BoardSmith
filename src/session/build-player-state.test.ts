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
import { GameRunner } from '../runtime/runner.js';
import { buildPlayerState } from './utils.js';

// Test game classes
class TestGame extends Game<TestGame, Player> {
  board!: Board;
  hands!: Hand[];

  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);

    this.registerElements([Card, Hand, Board]);

    // Create board
    this.board = this.create(Board, 'board');

    // Create per-player hands with visibility
    this.hands = [];
    for (const player of this.all(Player)) {
      const hand = this.create(Hand, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      this.hands.push(hand);
    }

    // Put a card in each player's hand so we can test per-player visibility
    for (const [i, hand] of this.hands.entries()) {
      hand.create(Card, `secret-${i + 1}`, { value: (i + 1) * 10 });
    }

    // Register actions

    // Action that triggers a single animation event
    const animateAction = Action.create('strike')
      .prompt('Strike')
      .execute((_args, ctx) => {
        ctx.game.animate('combat', { damage: 5 });
      });

    // Action that triggers multiple animation events
    const multiAnimateAction = Action.create('combo')
      .prompt('Combo')
      .execute((_args, ctx) => {
        ctx.game.animate('slash', { target: 'a' });
        ctx.game.animate('thrust', { target: 'b' });
        ctx.game.animate('finisher', { target: 'c' });
      });

    // Action with no animation
    const passAction = Action.create('pass')
      .prompt('Pass turn')
      .execute(() => {});

    this.registerActions(animateAction, multiAnimateAction, passAction);

    // Set up flow
    const gameFlow = defineFlow({
      root: loop({
        while: (ctx: FlowContext) => (ctx.get<number>('round') ?? 1) <= 3,
        maxIterations: 10,
        do: eachPlayer({
          do: actionStep({
            actions: ['strike', 'combo', 'pass'],
          }),
        }),
      }),
      setup: (ctx) => ctx.set('round', 1),
    });
    this.setFlow(gameFlow);
  }
}

class Card extends Piece<TestGame> {
  value!: number;
}

class Hand extends Space<TestGame> {}
class Board extends Space<TestGame> {}

describe('buildPlayerState - single truth view (SES-01)', () => {
  let runner: GameRunner<TestGame>;

  beforeEach(() => {
    runner = new GameRunner({
      GameClass: TestGame,
      gameType: 'test-game',
      gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'test' },
    });
    runner.start();
  });

  it('returns view field with truth state and no currentView field', () => {
    const state = buildPlayerState(runner, ['Alice', 'Bob'], 1);

    // view field exists and contains state
    expect(state.view).toBeDefined();
    expect(typeof state.view).toBe('object');

    // No currentView field (theatre split removed in Phase 85)
    expect('currentView' in state).toBe(false);

    // view matches what runner.getPlayerView returns
    const directView = runner.getPlayerView(1).state;
    expect(state.view).toEqual(directView);
  });

  it('preserves per-player visibility filtering', () => {
    const stateP1 = buildPlayerState(runner, ['Alice', 'Bob'], 1);
    const stateP2 = buildPlayerState(runner, ['Alice', 'Bob'], 2);

    // Each player should see different views (hidden hands)
    expect(stateP1.view).not.toEqual(stateP2.view);
  });
});

describe('buildPlayerState - availableActions scoped to current player', () => {
  let runner: GameRunner<TestGame>;

  beforeEach(() => {
    runner = new GameRunner({
      GameClass: TestGame,
      gameType: 'test-game',
      gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'test' },
    });
    runner.start();
  });

  it('current player sees available actions', () => {
    const state = buildPlayerState(runner, ['Alice', 'Bob'], 1);
    expect(state.isMyTurn).toBe(true);
    expect(state.availableActions.length).toBeGreaterThan(0);
  });

  it('non-current player sees empty available actions', () => {
    const state = buildPlayerState(runner, ['Alice', 'Bob'], 2);
    expect(state.isMyTurn).toBe(false);
    expect(state.availableActions).toEqual([]);
  });

  it('non-current player gets no action metadata even when requested', () => {
    const state = buildPlayerState(runner, ['Alice', 'Bob'], 2, { includeActionMetadata: true });
    expect(state.isMyTurn).toBe(false);
    expect(state.availableActions).toEqual([]);
    expect(state.actionMetadata).toBeUndefined();
  });
});

describe('buildPlayerState - animation events (SES-02)', () => {
  let runner: GameRunner<TestGame>;

  beforeEach(() => {
    runner = new GameRunner({
      GameClass: TestGame,
      gameType: 'test-game',
      gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'test' },
    });
    runner.start();
  });

  it('includes animationEvents when game has pending events', () => {
    // Perform an action that triggers game.animate()
    runner.performAction('strike', 1, {});

    const state = buildPlayerState(runner, ['Alice', 'Bob'], 1);

    expect(state.animationEvents).toBeDefined();
    expect(state.animationEvents!.length).toBeGreaterThan(0);
    expect(state.animationEvents![0].type).toBe('combat');
    expect(state.lastAnimationEventId).toBe(state.animationEvents![state.animationEvents!.length - 1].id);
  });

  it('omits animationEvents when buffer is empty', () => {
    // No action performed -- buffer is empty
    const state = buildPlayerState(runner, ['Alice', 'Bob'], 1);

    expect(state.animationEvents).toBeUndefined();
    expect(state.lastAnimationEventId).toBeUndefined();
  });

  it('includes all animation events from a single action', () => {
    // Perform an action that triggers 3 animate() calls
    runner.performAction('combo', 1, {});

    const state = buildPlayerState(runner, ['Alice', 'Bob'], 1);

    expect(state.animationEvents).toHaveLength(3);
    expect(state.animationEvents![0].id).toBe(1);
    expect(state.animationEvents![1].id).toBe(2);
    expect(state.animationEvents![2].id).toBe(3);
    expect(state.lastAnimationEventId).toBe(3);
  });
});
