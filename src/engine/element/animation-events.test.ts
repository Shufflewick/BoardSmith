import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
} from '../index.js';
import type { AnimationEvent } from '../index.js';

// Test classes
class TestGame extends Game<TestGame, Player> {}

class Token extends Piece<TestGame> {
  hp!: number;
}

class Board extends Space<TestGame> {}

function createTestGame(): TestGame {
  const game = new TestGame({ playerCount: 2 });
  const board = game.create(Board, 'board');
  board.create(Token, 'warrior', { hp: 10 });
  board.create(Token, 'archer', { hp: 8 });
  return game;
}

describe('animate - pure data events', () => {
  let game: TestGame;

  beforeEach(() => {
    game = createTestGame();
  });

  it('should emit a pure data event with correct type and data', () => {
    game.animate('combat', { attacker: 1, defender: 2, damage: 5 });

    const events = game.pendingAnimationEvents;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('combat');
    expect(events[0].data).toEqual({ attacker: 1, defender: 2, damage: 5 });
    expect(events[0].id).toBe(1);
  });

  it('should auto-increment IDs for multiple events', () => {
    game.animate('attack', { target: 'a' });
    game.animate('defend', { target: 'b' });
    game.animate('heal', { target: 'c' });

    const events = game.pendingAnimationEvents;
    expect(events).toHaveLength(3);
    expect(events[0].id).toBe(1);
    expect(events[1].id).toBe(2);
    expect(events[2].id).toBe(3);
  });

  it('should include a timestamp on each event', () => {
    game.animate('score', { points: 10 });

    const events = game.pendingAnimationEvents;
    expect(typeof events[0].timestamp).toBe('number');
    expect(events[0].timestamp).toBeGreaterThan(0);
  });

  it('should contain exactly the data passed, with no extra mutation metadata', () => {
    game.animate('score', { points: 15 });

    const event = game.pendingAnimationEvents[0];
    expect(event.data).toEqual({ points: 15 });
    expect(event).not.toHaveProperty('mutations');
    expect(event).not.toHaveProperty('commands');
  });
});

describe('animate - callback', () => {
  let game: TestGame;

  beforeEach(() => {
    game = createTestGame();
  });

  it('should execute callback immediately', () => {
    let callbackRan = false;

    game.animate('combat', { damage: 5 }, () => {
      callbackRan = true;
    });

    expect(callbackRan).toBe(true);
  });

  it('should generate separate commands for callback mutations', () => {
    const warrior = game.first(Token, 'warrior')!;

    game.animate('combat', { damage: 5 }, () => {
      // Explicitly execute a command in the callback, as game code would
      game.execute({
        type: 'SET_ATTRIBUTE',
        elementId: warrior.id,
        attribute: 'hp',
        value: 5,
      });
    });

    // The command history should have the ANIMATE command, then a SET_ATTRIBUTE
    const commands = game.commandHistory;
    const animateIdx = commands.findIndex(c => c.type === 'ANIMATE');
    const setAttrIdx = commands.findIndex(c => c.type === 'SET_ATTRIBUTE');

    expect(animateIdx).toBeGreaterThanOrEqual(0);
    expect(setAttrIdx).toBeGreaterThan(animateIdx);
  });

  it('should NOT include callback mutations in event data', () => {
    const warrior = game.first(Token, 'warrior')!;

    game.animate('combat', { damage: 5 }, () => {
      // This generates a SET_ATTRIBUTE command, but it should NOT appear in the event data
      game.execute({
        type: 'SET_ATTRIBUTE',
        elementId: warrior.id,
        attribute: 'hp',
        value: 5,
      });
    });

    const event = game.pendingAnimationEvents[0];
    expect(event.data).toEqual({ damage: 5 });
    expect(event).not.toHaveProperty('mutations');
  });

  it('should work without callback (callback is optional)', () => {
    game.animate('score', { points: 10 });

    const events = game.pendingAnimationEvents;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('score');
  });

  it('should propagate callback errors without swallowing them', () => {
    expect(() => {
      game.animate('combat', { damage: 5 }, () => {
        throw new Error('Callback failed');
      });
    }).toThrow('Callback failed');

    // The ANIMATE command should still be on the stack even after callback error
    const animateCommands = game.commandHistory.filter(c => c.type === 'ANIMATE');
    expect(animateCommands).toHaveLength(1);
  });
});

describe('animate - command stack', () => {
  let game: TestGame;

  beforeEach(() => {
    game = createTestGame();
  });

  it('should add ANIMATE command to commandHistory', () => {
    game.animate('score', { points: 10 });

    const animateCommands = game.commandHistory.filter(c => c.type === 'ANIMATE');
    expect(animateCommands).toHaveLength(1);

    const cmd = animateCommands[0] as { type: string; eventType: string; data: Record<string, unknown> };
    expect(cmd.eventType).toBe('score');
    expect(cmd.data).toEqual({ points: 10 });
  });

  it('should not be invertible (undoLastCommand returns false)', () => {
    game.animate('score', { points: 10 });

    const undone = game.undoLastCommand();
    expect(undone).toBe(false);
  });

  it('should produce multiple ANIMATE commands in order', () => {
    game.animate('attack', { target: 'a' });
    game.animate('defend', { shield: true });
    game.animate('heal', { amount: 3 });

    const animateCommands = game.commandHistory.filter(c => c.type === 'ANIMATE');
    expect(animateCommands).toHaveLength(3);

    const types = animateCommands.map(c => (c as { eventType: string }).eventType);
    expect(types).toEqual(['attack', 'defend', 'heal']);
  });

  it('should survive JSON serialization round-trip via toJSON', () => {
    game.animate('score', { points: 10 });

    const json = game.toJSON();

    // commandHistory includes ANIMATE commands
    const animateInHistory = game.commandHistory.filter(c => c.type === 'ANIMATE');
    expect(animateInHistory).toHaveLength(1);

    // The JSON includes animation events in the serialized state
    expect(json.animationEvents).toBeDefined();
    expect(json.animationEvents).toHaveLength(1);
    expect(json.animationEvents![0].type).toBe('score');
    expect(json.animationEvents![0].data).toEqual({ points: 10 });
  });

  it('should rebuild animation events when replaying commands on a new game', () => {
    game.animate('score', { points: 10 });
    game.animate('bonus', { multiplier: 2 });

    const originalCommands = [...game.commandHistory];

    // Create a fresh game and replay the commands
    const freshGame = new TestGame({ playerCount: 2 });
    freshGame.create(Board, 'board');
    freshGame.replayCommands(originalCommands);

    const events = freshGame.pendingAnimationEvents;
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('score');
    expect(events[0].data).toEqual({ points: 10 });
    expect(events[1].type).toBe('bonus');
    expect(events[1].data).toEqual({ multiplier: 2 });
  });
});

describe('animate - buffer lifecycle', () => {
  let game: TestGame;

  beforeEach(() => {
    game = createTestGame();
  });

  it('should make events available via pendingAnimationEvents after animate()', () => {
    game.animate('score', { points: 10 });

    const events = game.pendingAnimationEvents;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('score');
  });

  it('should clear buffer at start of performAction', () => {
    // Emit event directly
    game.animate('oldEvent', { stale: true });
    expect(game.pendingAnimationEvents).toHaveLength(1);

    // Register an action that does NOT call animate
    const action = Action.create('doNothing').execute(() => {});
    game.registerAction(action);

    // Performing an action clears the buffer
    game.performAction('doNothing', game.getPlayer(1)!, {});

    expect(game.pendingAnimationEvents).toHaveLength(0);
  });

  it('should only contain events from the current action after performAction', () => {
    // Emit a stale event
    game.animate('stale', { old: true });
    expect(game.pendingAnimationEvents).toHaveLength(1);

    // Register an action that emits a new event
    const action = Action.create('attack').execute((_args, ctx) => {
      ctx.game.animate('combat', { fresh: true });
    });
    game.registerAction(action);

    game.performAction('attack', game.getPlayer(1)!, {});

    const events = game.pendingAnimationEvents;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('combat');
    expect(events[0].data).toEqual({ fresh: true });
  });

  it('should replace previous events when a second action executes', () => {
    // First action emits events
    const action1 = Action.create('firstAction').execute((_args, ctx) => {
      ctx.game.animate('first', { order: 1 });
    });
    game.registerAction(action1);
    game.performAction('firstAction', game.getPlayer(1)!, {});

    expect(game.pendingAnimationEvents).toHaveLength(1);
    expect(game.pendingAnimationEvents[0].type).toBe('first');

    // Second action replaces the buffer
    const action2 = Action.create('secondAction').execute((_args, ctx) => {
      ctx.game.animate('second', { order: 2 });
      ctx.game.animate('bonus', { order: 3 });
    });
    game.registerAction(action2);
    game.performAction('secondAction', game.getPlayer(1)!, {});

    const events = game.pendingAnimationEvents;
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('second');
    expect(events[1].type).toBe('bonus');
  });

  it('should persist events emitted outside performAction until next performAction clears them', () => {
    // Emit directly (not inside an action)
    game.animate('direct', { value: 42 });
    expect(game.pendingAnimationEvents).toHaveLength(1);

    // Events persist -- they are not auto-cleared
    expect(game.pendingAnimationEvents).toHaveLength(1);
    expect(game.pendingAnimationEvents[0].type).toBe('direct');
  });

  it('should leave buffer empty after performAction if no animate() calls happen', () => {
    const action = Action.create('noop').execute(() => {});
    game.registerAction(action);

    game.performAction('noop', game.getPlayer(1)!, {});

    expect(game.pendingAnimationEvents).toHaveLength(0);
  });
});
