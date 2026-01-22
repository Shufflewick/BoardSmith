import { describe, it, expect, beforeEach } from 'vitest';
import { Game, AnimationEvent } from './game.js';
import { Player } from '../player/player.js';

class TestGame extends Game<TestGame, Player> {}

describe('Animation Events', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2, seed: 'test' });
  });

  describe('emitAnimationEvent', () => {
    it('should emit an event with unique ID', () => {
      const event = game.emitAnimationEvent('combat', { damage: 5 });

      expect(event.id).toBe(1);
      expect(event.type).toBe('combat');
      expect(event.data).toEqual({ damage: 5 });
      expect(event.timestamp).toBeGreaterThan(0);
    });

    it('should assign monotonically increasing IDs', () => {
      const event1 = game.emitAnimationEvent('combat', {});
      const event2 = game.emitAnimationEvent('score', {});
      const event3 = game.emitAnimationEvent('move', {});

      expect(event1.id).toBe(1);
      expect(event2.id).toBe(2);
      expect(event3.id).toBe(3);
    });

    it('should include optional group', () => {
      const event = game.emitAnimationEvent('combat', { damage: 5 }, { group: 'turn-1' });

      expect(event.group).toBe('turn-1');
    });

    it('should not include group when not provided', () => {
      const event = game.emitAnimationEvent('combat', { damage: 5 });

      expect(event.group).toBeUndefined();
    });

    it('should shallow copy data to prevent external mutation', () => {
      const data = { value: 1 };
      const event = game.emitAnimationEvent('test', data);

      data.value = 999;
      expect(event.data.value).toBe(1);
    });
  });

  describe('pendingAnimationEvents', () => {
    it('should return empty array when no events', () => {
      expect(game.pendingAnimationEvents).toEqual([]);
    });

    it('should return all emitted events', () => {
      game.emitAnimationEvent('a', {});
      game.emitAnimationEvent('b', {});
      game.emitAnimationEvent('c', {});

      const pending = game.pendingAnimationEvents;
      expect(pending).toHaveLength(3);
      expect(pending.map(e => e.type)).toEqual(['a', 'b', 'c']);
    });

    it('should return a copy (not affect internal buffer)', () => {
      game.emitAnimationEvent('test', {});

      const pending = game.pendingAnimationEvents;
      pending.push({ id: 999, type: 'fake', data: {}, timestamp: 0 });

      expect(game.pendingAnimationEvents).toHaveLength(1);
    });
  });

  describe('acknowledgeAnimationEvents', () => {
    it('should clear events up to given ID', () => {
      game.emitAnimationEvent('a', {});
      game.emitAnimationEvent('b', {});
      game.emitAnimationEvent('c', {});

      game.acknowledgeAnimationEvents(2);

      const pending = game.pendingAnimationEvents;
      expect(pending).toHaveLength(1);
      expect(pending[0].type).toBe('c');
    });

    it('should be safe with ID higher than any event', () => {
      game.emitAnimationEvent('a', {});
      game.emitAnimationEvent('b', {});

      game.acknowledgeAnimationEvents(999);

      expect(game.pendingAnimationEvents).toHaveLength(0);
    });

    it('should be safe with ID of zero (no-op)', () => {
      game.emitAnimationEvent('a', {});
      game.emitAnimationEvent('b', {});

      game.acknowledgeAnimationEvents(0);

      expect(game.pendingAnimationEvents).toHaveLength(2);
    });

    it('should be idempotent', () => {
      game.emitAnimationEvent('a', {});
      game.emitAnimationEvent('b', {});

      game.acknowledgeAnimationEvents(1);
      game.acknowledgeAnimationEvents(1);
      game.acknowledgeAnimationEvents(1);

      expect(game.pendingAnimationEvents).toHaveLength(1);
    });
  });

  describe('serialization', () => {
    it('should serialize animation events in toJSON', () => {
      game.emitAnimationEvent('combat', { damage: 5 });
      game.emitAnimationEvent('score', { points: 10 }, { group: 'turn-1' });

      const json = game.toJSON();

      expect(json.animationEvents).toHaveLength(2);
      expect(json.animationEventSeq).toBe(2);
      expect(json.animationEvents![0].type).toBe('combat');
      expect(json.animationEvents![1].group).toBe('turn-1');
    });

    it('should not include animation events when buffer is empty', () => {
      const json = game.toJSON();

      expect(json.animationEvents).toBeUndefined();
      expect(json.animationEventSeq).toBeUndefined();
    });

    it('should restore animation events from JSON', () => {
      game.emitAnimationEvent('combat', { damage: 5 });
      game.emitAnimationEvent('score', { points: 10 });

      const json = game.toJSON();
      const restored = Game.restoreGame(json, TestGame, new Map());

      const pending = restored.pendingAnimationEvents;
      expect(pending).toHaveLength(2);
      expect(pending[0].type).toBe('combat');
      expect(pending[1].type).toBe('score');
    });

    it('should restore sequence counter (no duplicate IDs after restore)', () => {
      game.emitAnimationEvent('a', {});
      game.emitAnimationEvent('b', {});

      const json = game.toJSON();
      const restored = Game.restoreGame(json, TestGame, new Map());

      // New events should continue from where we left off
      const newEvent = restored.emitAnimationEvent('c', {});
      expect(newEvent.id).toBe(3);
    });

    it('should handle restore with no animation events', () => {
      const json = game.toJSON();
      const restored = Game.restoreGame(json, TestGame, new Map());

      expect(restored.pendingAnimationEvents).toEqual([]);

      // Should start fresh
      const event = restored.emitAnimationEvent('test', {});
      expect(event.id).toBe(1);
    });

    it('should preserve events after partial acknowledgment and restore', () => {
      game.emitAnimationEvent('a', {});
      game.emitAnimationEvent('b', {});
      game.emitAnimationEvent('c', {});
      game.acknowledgeAnimationEvents(1);

      const json = game.toJSON();
      const restored = Game.restoreGame(json, TestGame, new Map());

      const pending = restored.pendingAnimationEvents;
      expect(pending).toHaveLength(2);
      expect(pending.map(e => e.type)).toEqual(['b', 'c']);
    });
  });
});
