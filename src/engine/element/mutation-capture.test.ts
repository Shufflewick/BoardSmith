import { describe, it, expect, beforeEach } from 'vitest';
import { Game, type AnimationEvent } from './game.js';
import { Player } from '../player/player.js';

class ScoreGame extends Game<ScoreGame, Player> {
  score = 0;
  round = 1;
  status = 'playing';
}

describe('Mutation Capture - animate()', () => {
  let game: ScoreGame;

  beforeEach(() => {
    game = new ScoreGame({ playerCount: 2, seed: 'test' });
  });

  // =============================================
  // animate() basics
  // =============================================

  describe('basics', () => {
    it('returns an AnimationEvent with type, data, and mutations array', () => {
      const event = game.animate('combat', { damage: 5 }, () => {});

      expect(event.id).toBeGreaterThan(0);
      expect(event.type).toBe('combat');
      expect(event.data).toEqual({ damage: 5 });
      expect(event.timestamp).toBeGreaterThan(0);
      expect(event.mutations).toEqual([]);
    });

    it('assigns monotonically increasing IDs', () => {
      const event1 = game.animate('a', {}, () => {});
      const event2 = game.animate('b', {}, () => {});
      const event3 = game.animate('c', {}, () => {});

      expect(event1.id).toBe(1);
      expect(event2.id).toBe(2);
      expect(event3.id).toBe(3);
    });

    it('assigns monotonically increasing IDs interleaved with emitAnimationEvent', () => {
      const event1 = game.emitAnimationEvent('a', {});
      const event2 = game.animate('b', {}, () => {});
      const event3 = game.emitAnimationEvent('c', {});
      const event4 = game.animate('d', {}, () => {});

      expect(event1.id).toBe(1);
      expect(event2.id).toBe(2);
      expect(event3.id).toBe(3);
      expect(event4.id).toBe(4);
    });

    it('adds the returned event to pendingAnimationEvents', () => {
      const event = game.animate('test', {}, () => {});
      const pending = game.pendingAnimationEvents;

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(event.id);
      expect(pending[0].type).toBe('test');
    });

    it('shallow-copies data to prevent external mutation', () => {
      const data = { value: 1 };
      const event = game.animate('test', data, () => {});

      data.value = 999;
      expect(event.data.value).toBe(1);
    });
  });

  // =============================================
  // Property mutation capture
  // =============================================

  describe('property mutation capture', () => {
    it('captures a single property change as SET_PROPERTY mutation', () => {
      const event = game.animate('score', {}, () => {
        game.score = 10;
      });

      expect(event.mutations).toHaveLength(1);
      expect(event.mutations![0]).toEqual({
        type: 'SET_PROPERTY',
        property: 'score',
        oldValue: 0,
        newValue: 10,
      });
    });

    it('captures multiple property changes in one callback', () => {
      const event = game.animate('update', {}, () => {
        game.score = 25;
        game.round = 3;
        game.status = 'finished';
      });

      expect(event.mutations).toHaveLength(3);

      const props = event.mutations!.map(m => (m as any).property).sort();
      expect(props).toEqual(['round', 'score', 'status']);

      const scoreMut = event.mutations!.find(m => (m as any).property === 'score');
      expect(scoreMut).toEqual({
        type: 'SET_PROPERTY',
        property: 'score',
        oldValue: 0,
        newValue: 25,
      });
    });

    it('produces no mutations when properties do not change', () => {
      const event = game.animate('noop', {}, () => {
        // Read but don't change
        const _s = game.score;
      });

      expect(event.mutations).toHaveLength(0);
    });

    it('produces no mutations for assignment to same value', () => {
      game.score = 0; // Already 0
      const event = game.animate('noop', {}, () => {
        game.score = 0;
      });

      expect(event.mutations).toHaveLength(0);
    });
  });

  // =============================================
  // Callback execution
  // =============================================

  describe('callback execution', () => {
    it('executes callback synchronously', () => {
      let flag = false;
      game.animate('test', {}, () => {
        flag = true;
      });
      expect(flag).toBe(true);
    });

    it('mutations apply immediately to game state', () => {
      game.animate('score', {}, () => {
        game.score = 42;
      });
      expect(game.score).toBe(42);
    });

    it('cleans up _captureContext if callback throws', () => {
      expect(() => {
        game.animate('error', {}, () => {
          throw new Error('kaboom');
        });
      }).toThrow('kaboom');

      expect(game._captureContext).toBeNull();
    });

    it('does not add event to pending when callback throws', () => {
      try {
        game.animate('error', {}, () => {
          throw new Error('kaboom');
        });
      } catch {
        // expected
      }

      expect(game.pendingAnimationEvents).toHaveLength(0);
    });

    it('game state changes persist even if callback throws', () => {
      try {
        game.animate('error', {}, () => {
          game.score = 99;
          throw new Error('kaboom');
        });
      } catch {
        // expected
      }

      // Mutations apply immediately; the error prevents event creation but not state changes
      expect(game.score).toBe(99);
    });
  });

  // =============================================
  // Nested animate() prevention
  // =============================================

  describe('nested animate() prevention', () => {
    it('throws when calling animate() inside an animate() callback', () => {
      expect(() => {
        game.animate('outer', {}, () => {
          game.animate('inner', {}, () => {});
        });
      }).toThrow('Cannot call game.animate()');
    });

    it('properly cleans up outer context after nested error', () => {
      try {
        game.animate('outer', {}, () => {
          game.animate('inner', {}, () => {});
        });
      } catch {
        // expected
      }

      // Context should be cleaned up (the outer finally ran)
      expect(game._captureContext).toBeNull();
    });

    it('can call animate() again after a nested error was caught inside the callback', () => {
      // The outer animate throws because the inner one throws before the outer finally
      // After the error is caught at the call site, the context is clean
      try {
        game.animate('outer', {}, () => {
          try {
            game.animate('inner', {}, () => {});
          } catch {
            // Catching inside the callback - outer still active
          }
          // We're still inside outer animate, context still set
        });
      } catch {
        // won't throw because inner error was caught
      }

      // After outer completes, context is clean and we can animate again
      const event = game.animate('after', {}, () => {
        game.score = 5;
      });
      expect(event.type).toBe('after');
      expect(event.mutations).toHaveLength(1);
    });
  });

  // =============================================
  // emitAnimationEvent compatibility
  // =============================================

  describe('emitAnimationEvent compatibility', () => {
    it('emitAnimationEvent still works and returns event without mutations field', () => {
      const event = game.emitAnimationEvent('combat', { damage: 5 });

      expect(event.type).toBe('combat');
      expect(event.data).toEqual({ damage: 5 });
      expect(event.mutations).toBeUndefined();
    });

    it('animate() and emitAnimationEvent share the same ID counter', () => {
      const e1 = game.emitAnimationEvent('a', {});
      const e2 = game.animate('b', {}, () => {});
      const e3 = game.emitAnimationEvent('c', {});

      expect(e1.id).toBe(1);
      expect(e2.id).toBe(2);
      expect(e3.id).toBe(3);
    });

    it('acknowledgment works for events from both APIs', () => {
      game.emitAnimationEvent('a', {});
      game.animate('b', {}, () => {});
      game.emitAnimationEvent('c', {});

      game.acknowledgeAnimationEvents(2);

      const pending = game.pendingAnimationEvents;
      expect(pending).toHaveLength(1);
      expect(pending[0].type).toBe('c');
    });
  });

  // =============================================
  // Empty callback
  // =============================================

  describe('empty callback', () => {
    it('produces event with empty mutations array', () => {
      const event = game.animate('empty', { note: 'nothing happened' }, () => {});

      expect(event.mutations).toEqual([]);
      expect(event.type).toBe('empty');
      expect(event.data).toEqual({ note: 'nothing happened' });
    });
  });
});
