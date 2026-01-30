import { describe, test, expect, beforeEach } from 'vitest';
import { Game, Player, defineFlow, actionStep, Action, type GameOptions } from '../engine/index.js';
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
          this.emitAnimationEvent('attack', { damage: 5 });
          return { success: true };
        })
    );

    this.registerAction(
      Action.create('heal')
        .execute(() => {
          this.emitAnimationEvent('heal', { amount: 3 });
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
      session.runner.game.emitAnimationEvent('attack', { damage: 5 });
      session.runner.game.emitAnimationEvent('heal', { amount: 3 });

      const state = session.buildPlayerState(1);
      expect(state.animationEvents).toHaveLength(2);
      expect(state.animationEvents![0].type).toBe('attack');
      expect(state.animationEvents![1].type).toBe('heal');
    });

    test('lastAnimationEventId is ID of final event', () => {
      session.runner.game.emitAnimationEvent('attack', { damage: 5 });
      const event2 = session.runner.game.emitAnimationEvent('heal', { amount: 3 });

      const state = session.buildPlayerState(1);
      expect(state.lastAnimationEventId).toBe(event2.id);
    });

    test('spectators receive animation events', () => {
      session.runner.game.emitAnimationEvent('attack', { damage: 5 });

      const spectatorState = session.buildPlayerState(0);
      expect(spectatorState.animationEvents).toHaveLength(1);
      expect(spectatorState.animationEvents![0].type).toBe('attack');
    });
  });

  describe('acknowledgeAnimations', () => {
    test('clears acknowledged events from state', () => {
      const event1 = session.runner.game.emitAnimationEvent('attack', { damage: 5 });
      session.runner.game.emitAnimationEvent('heal', { amount: 3 });

      // Acknowledge first event only
      session.acknowledgeAnimations(1, event1.id);

      const state = session.buildPlayerState(1);
      expect(state.animationEvents).toHaveLength(1);
      expect(state.animationEvents![0].type).toBe('heal');
    });

    test('acknowledging all events clears buffer', () => {
      session.runner.game.emitAnimationEvent('attack', { damage: 5 });
      const event2 = session.runner.game.emitAnimationEvent('heal', { amount: 3 });

      session.acknowledgeAnimations(1, event2.id);

      const state = session.buildPlayerState(1);
      expect(state.animationEvents).toBeUndefined();
      expect(state.lastAnimationEventId).toBeUndefined();
    });

    test('idempotent - repeated acknowledgment is safe', () => {
      const event = session.runner.game.emitAnimationEvent('attack', { damage: 5 });

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
