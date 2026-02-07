import { describe, test, expect, beforeEach } from 'vitest';
import { Game, Player, Space, Piece, defineFlow, actionStep, Action, type GameOptions } from '../engine/index.js';
import { GameSession } from './game-session.js';

// Minimal test game that can emit animation events
class TestGame extends Game {
  constructor(options: GameOptions) {
    super(options);

    // Register actions - one that emits animation events
    this.registerAction(
      Action.create('pass')
        .execute(() => ({ success: true }))
    );

    this.registerAction(
      Action.create('attack')
        .execute(() => {
          this.animate('attack', { damage: 5 }, () => {});
          return { success: true };
        })
    );

    this.registerAction(
      Action.create('heal')
        .execute(() => {
          this.animate('heal', { amount: 3 }, () => {});
          return { success: true };
        })
    );

    // Set up minimal flow - use maxMoves: 2 to allow exactly 2 actions
    this.setFlow(defineFlow({
      root: actionStep({ actions: ['pass', 'attack', 'heal'], maxMoves: 2 }),
    }));
  }
}

describe('Session Animation Events', () => {
  let session: GameSession<TestGame>;

  beforeEach(() => {
    session = GameSession.create({
      gameType: 'test',
      GameClass: TestGame,
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
    });
  });

  describe('PlayerGameState animation fields', () => {
    test('animationEvents is undefined when buffer is empty', () => {
      const state = session.buildPlayerState(1);
      expect(state.animationEvents).toBeUndefined();
      expect(state.lastAnimationEventId).toBeUndefined();
    });

    test('animationEvents contains pending events', () => {
      session.runner.game.animate('attack', { damage: 5 }, () => {});
      session.runner.game.animate('heal', { amount: 3 }, () => {});

      const state = session.buildPlayerState(1);
      expect(state.animationEvents).toHaveLength(2);
      expect(state.animationEvents![0].type).toBe('attack');
      expect(state.animationEvents![1].type).toBe('heal');
    });

    test('lastAnimationEventId is ID of final event', () => {
      session.runner.game.animate('attack', { damage: 5 }, () => {});
      const event2 = session.runner.game.animate('heal', { amount: 3 }, () => {});

      const state = session.buildPlayerState(1);
      expect(state.lastAnimationEventId).toBe(event2.id);
    });

    test('spectators receive animation events', () => {
      session.runner.game.animate('attack', { damage: 5 }, () => {});

      const spectatorState = session.buildPlayerState(0);
      expect(spectatorState.animationEvents).toHaveLength(1);
      expect(spectatorState.animationEvents![0].type).toBe('attack');
    });
  });

  describe('acknowledgeAnimations', () => {
    test('clears acknowledged events from state', () => {
      const event1 = session.runner.game.animate('attack', { damage: 5 }, () => {});
      session.runner.game.animate('heal', { amount: 3 }, () => {});

      // Acknowledge first event only
      session.acknowledgeAnimations(1, event1.id);

      const state = session.buildPlayerState(1);
      expect(state.animationEvents).toHaveLength(1);
      expect(state.animationEvents![0].type).toBe('heal');
    });

    test('acknowledging all events clears buffer', () => {
      session.runner.game.animate('attack', { damage: 5 }, () => {});
      const event2 = session.runner.game.animate('heal', { amount: 3 }, () => {});

      session.acknowledgeAnimations(1, event2.id);

      const state = session.buildPlayerState(1);
      expect(state.animationEvents).toBeUndefined();
      expect(state.lastAnimationEventId).toBeUndefined();
    });

    test('idempotent - repeated acknowledgment is safe', () => {
      const event = session.runner.game.animate('attack', { damage: 5 }, () => {});

      session.acknowledgeAnimations(1, event.id);
      session.acknowledgeAnimations(1, event.id); // Second call

      const state = session.buildPlayerState(1);
      expect(state.animationEvents).toBeUndefined();
    });
  });

  describe('snapshot serialization (SES-04)', () => {
    test('animation events emitted during actions survive session restore', async () => {
      // Emit events via actions (these get recorded in action history)
      await session.performAction('attack', 1, {});
      await session.performAction('heal', 1, {});

      // Get stored state (includes action history)
      const storedState = session.storedState;

      // Restore session - replays action history, which re-emits events
      const restoredSession = GameSession.restore(storedState, TestGame);

      // Check events are present in restored session
      const state = restoredSession.buildPlayerState(1);
      expect(state.animationEvents).toHaveLength(2);
      expect(state.animationEvents![0].type).toBe('attack');
      expect(state.animationEvents![1].type).toBe('heal');
    });

    test('restored session can acknowledge events', async () => {
      // Emit event via action
      await session.performAction('attack', 1, {});

      // Get the event ID
      const originalState = session.buildPlayerState(1);
      const eventId = originalState.lastAnimationEventId!;

      // Restore session
      const storedState = session.storedState;
      const restoredSession = GameSession.restore(storedState, TestGame);

      // Acknowledge in restored session
      restoredSession.acknowledgeAnimations(1, eventId);

      const state = restoredSession.buildPlayerState(1);
      expect(state.animationEvents).toBeUndefined();
    });
  });
});

// ============================================
// Theatre View in PlayerGameState
// ============================================

// Test game that uses game.animate() (new API) to trigger theatre snapshot creation
class TheatreTestGame extends Game {
  constructor(options: GameOptions) {
    super(options);

    // Create a simple element tree: board space with a token piece
    const board = this.create(Space, 'board');
    board.create(Piece, 'token');

    this.registerAction(
      Action.create('animateMove')
        .execute((_args, { game }) => {
          const token = game.first(Piece, 'token')!;
          game.animate('move', { piece: 'token' }, () => {
            token.putInto(game);  // Move to root (changes position in tree)
          });
          return { success: true };
        })
    );

    this.registerAction(
      Action.create('pass')
        .execute(() => ({ success: true }))
    );

    this.setFlow(defineFlow({
      root: actionStep({ actions: ['animateMove', 'pass'], maxMoves: 10 }),
    }));
  }
}

/**
 * Recursively search an ElementJSON tree for a node with the given name.
 */
function findInView(view: any, name: string): any {
  if (view.name === name) return view;
  for (const child of view.children ?? []) {
    const found = findInView(child, name);
    if (found) return found;
  }
  return null;
}

describe('Theatre view in PlayerGameState', () => {
  let session: GameSession<TheatreTestGame>;

  beforeEach(() => {
    session = GameSession.create({
      gameType: 'theatre-test',
      GameClass: TheatreTestGame,
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
    });
  });

  test('view field contains theatre state (pre-animation) when animations pending', async () => {
    // Perform animateMove -- token moves from board to game root in truth,
    // but theatre snapshot should still show it inside board
    await session.performAction('animateMove', 1, {});

    const state = session.buildPlayerState(1);
    const boardInView = findInView(state.view, 'board');
    expect(boardInView).not.toBeNull();

    // Token should still be inside 'board' in the theatre view (pre-animation state)
    const tokenInBoard = boardInView.children?.some((c: any) => c.name === 'token');
    expect(tokenInBoard).toBe(true);
  });

  test('currentView is present when animations are pending', async () => {
    await session.performAction('animateMove', 1, {});

    const state = session.buildPlayerState(1);

    // currentView should be defined (truthy) because animations are pending
    expect(state.currentView).toBeDefined();

    // currentView shows truth -- token is at game root, NOT inside board
    const boardInTruth = findInView(state.currentView, 'board');
    expect(boardInTruth).not.toBeNull();
    const tokenInBoardTruth = (boardInTruth.children ?? []).some((c: any) => c.name === 'token');
    expect(tokenInBoardTruth).toBe(false);
  });

  test('currentView is undefined when no animations pending', () => {
    // No animate actions performed -- theatre and truth are the same
    const state = session.buildPlayerState(1);
    expect(state.currentView).toBeUndefined();
  });

  test('view updates after acknowledgeAnimations', async () => {
    await session.performAction('animateMove', 1, {});

    // Get the last animation event ID
    const stateBefore = session.buildPlayerState(1);
    const lastId = stateBefore.lastAnimationEventId!;
    expect(lastId).toBeDefined();

    // Acknowledge all events -- theatre state should advance to truth
    session.acknowledgeAnimations(1, lastId);

    const stateAfter = session.buildPlayerState(1);

    // view should now show the token at game root, NOT inside board
    const boardAfter = findInView(stateAfter.view, 'board');
    expect(boardAfter).not.toBeNull();
    const tokenInBoardAfter = (boardAfter.children ?? []).some((c: any) => c.name === 'token');
    expect(tokenInBoardAfter).toBe(false);

    // currentView should be undefined (no longer divergent)
    expect(stateAfter.currentView).toBeUndefined();
  });

  test('all players see the same theatre view for shared elements', async () => {
    await session.performAction('animateMove', 1, {});

    const state1 = session.buildPlayerState(1);
    const state2 = session.buildPlayerState(2);

    // Both players should see token inside board (theatre state, pre-animation)
    const board1 = findInView(state1.view, 'board');
    const board2 = findInView(state2.view, 'board');
    expect(board1.children?.some((c: any) => c.name === 'token')).toBe(true);
    expect(board2.children?.some((c: any) => c.name === 'token')).toBe(true);

    // Neither player sees "spoilers" (the new position at game root)
    // Both views should be identical for shared elements
    expect(JSON.stringify(state1.view)).toBe(JSON.stringify(state2.view));
  });

  test('restored session preserves theatre view', async () => {
    await session.performAction('animateMove', 1, {});

    // Store and restore
    const storedState = session.storedState;
    const restoredSession = GameSession.restore(storedState, TheatreTestGame);

    const state = restoredSession.buildPlayerState(1);

    // Theatre view should still show pre-animation state
    const boardInView = findInView(state.view, 'board');
    expect(boardInView).not.toBeNull();
    const tokenInBoard = boardInView.children?.some((c: any) => c.name === 'token');
    expect(tokenInBoard).toBe(true);

    // currentView should be present (truth diverges from theatre)
    expect(state.currentView).toBeDefined();
  });
});
