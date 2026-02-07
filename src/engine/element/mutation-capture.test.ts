import { describe, it, expect, beforeEach } from 'vitest';
import { Game, type AnimationEvent } from './game.js';
import { Player } from '../player/player.js';
import { Space } from './space.js';
import { Piece } from './piece.js';

class ScoreGame extends Game<ScoreGame, Player> {
  score = 0;
  round = 1;
  status = 'playing';
}

class ElementTestGame extends Game<ElementTestGame, Player> {
  score = 0;
}

class TokenPiece extends Piece<ElementTestGame, Player> {
  health = 10;
  color = 'red';
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

// =============================================================================
// Element Mutation Capture Integration Tests
// =============================================================================

describe('Mutation Capture - element interception', () => {
  let game: ElementTestGame;
  let board: Space;
  let hand: Space;
  let piece: Piece;

  beforeEach(() => {
    game = new ElementTestGame({ playerCount: 2, seed: 'test' });
    board = game.create(Space, 'board');
    hand = game.create(Space, 'hand');
    piece = board.create(Piece, 'token');
  });

  // =============================================
  // MOVE mutations
  // =============================================

  describe('MOVE mutations', () => {
    it('putInto() inside animate() records a MOVE mutation', () => {
      const boardId = board._t.id;
      const handId = hand._t.id;
      const pieceId = piece._t.id;

      const event = game.animate('move', {}, () => {
        piece.putInto(hand);
      });

      expect(event.mutations).toHaveLength(1);
      expect(event.mutations![0]).toEqual({
        type: 'MOVE',
        elementId: pieceId,
        fromParentId: boardId,
        toParentId: handId,
        position: undefined,
      });
    });

    it('remove() inside animate() records exactly one MOVE mutation', () => {
      const boardId = board._t.id;
      const pieceId = piece._t.id;
      const pileId = game.pile._t.id;

      const event = game.animate('death', {}, () => {
        piece.remove();
      });

      // remove() delegates to putInto(game.pile) -- exactly ONE MOVE, no duplicates
      const moveMutations = event.mutations!.filter(m => m.type === 'MOVE');
      expect(moveMutations).toHaveLength(1);
      expect(moveMutations[0]).toEqual({
        type: 'MOVE',
        elementId: pieceId,
        fromParentId: boardId,
        toParentId: pileId,
        position: undefined,
      });
    });

    it('multiple moves inside one animate() records multiple MOVE mutations', () => {
      const piece2 = board.create(Piece, 'token2');

      const event = game.animate('swap', {}, () => {
        piece.putInto(hand);
        piece2.putInto(hand);
      });

      const moveMutations = event.mutations!.filter(m => m.type === 'MOVE');
      expect(moveMutations).toHaveLength(2);
      expect(moveMutations[0].type).toBe('MOVE');
      expect(moveMutations[1].type).toBe('MOVE');
    });

    it('putInto() outside animate() records no mutations', () => {
      piece.putInto(hand);

      expect(game.pendingAnimationEvents).toHaveLength(0);
    });

    it('putInto() with position option records position in mutation', () => {
      const event = game.animate('move', {}, () => {
        piece.putInto(hand, { position: 'first' });
      });

      expect(event.mutations![0]).toMatchObject({
        type: 'MOVE',
        position: 'first',
      });
    });
  });

  // =============================================
  // CREATE mutations
  // =============================================

  describe('CREATE mutations', () => {
    it('create() inside animate() records a CREATE mutation', () => {
      const boardId = board._t.id;

      const event = game.animate('spawn', {}, () => {
        board.create(Piece, 'newPiece');
      });

      const createMutations = event.mutations!.filter(m => m.type === 'CREATE');
      expect(createMutations).toHaveLength(1);
      expect(createMutations[0]).toMatchObject({
        type: 'CREATE',
        className: 'Piece',
        name: 'newPiece',
        parentId: boardId,
      });
      // elementId should be a number
      expect(typeof (createMutations[0] as any).elementId).toBe('number');
    });

    it('create() with attributes records them in the mutation', () => {
      game._ctx.classRegistry.set('TokenPiece', TokenPiece);

      const event = game.animate('spawn', {}, () => {
        board.create(TokenPiece, 'warrior', { health: 20, color: 'blue' });
      });

      const createMutations = event.mutations!.filter(m => m.type === 'CREATE');
      expect(createMutations).toHaveLength(1);
      expect((createMutations[0] as any).attributes).toEqual({ health: 20, color: 'blue' });
    });

    it('create() outside animate() records no mutations', () => {
      board.create(Piece, 'outsidePiece');

      expect(game.pendingAnimationEvents).toHaveLength(0);
    });

    it('create() with no attributes omits attributes field from mutation', () => {
      const event = game.animate('spawn', {}, () => {
        board.create(Piece, 'plainPiece');
      });

      const createMutation = event.mutations!.find(m => m.type === 'CREATE');
      expect(createMutation).toBeDefined();
      expect((createMutation as any).attributes).toBeUndefined();
    });
  });

  // =============================================
  // SET_ATTRIBUTE mutations
  // =============================================

  describe('SET_ATTRIBUTE mutations', () => {
    it('attribute change inside animate() records SET_ATTRIBUTE mutation', () => {
      game._ctx.classRegistry.set('TokenPiece', TokenPiece);
      const token = board.create(TokenPiece, 'warrior', { health: 10, color: 'red' });

      const event = game.animate('damage', {}, () => {
        token.health = 5;
      });

      const attrMutations = event.mutations!.filter(m => m.type === 'SET_ATTRIBUTE');
      expect(attrMutations).toHaveLength(1);
      expect(attrMutations[0]).toEqual({
        type: 'SET_ATTRIBUTE',
        elementId: token._t.id,
        attribute: 'health',
        oldValue: 10,
        newValue: 5,
      });
    });

    it('multiple attribute changes on different elements', () => {
      game._ctx.classRegistry.set('TokenPiece', TokenPiece);
      const token1 = board.create(TokenPiece, 'warrior1');
      const token2 = board.create(TokenPiece, 'warrior2');

      const event = game.animate('battle', {}, () => {
        token1.health = 3;
        token2.health = 7;
      });

      const attrMutations = event.mutations!.filter(m => m.type === 'SET_ATTRIBUTE');
      expect(attrMutations).toHaveLength(2);

      const token1Mut = attrMutations.find(m => (m as any).elementId === token1._t.id);
      const token2Mut = attrMutations.find(m => (m as any).elementId === token2._t.id);
      expect(token1Mut).toMatchObject({ attribute: 'health', oldValue: 10, newValue: 3 });
      expect(token2Mut).toMatchObject({ attribute: 'health', oldValue: 10, newValue: 7 });
    });

    it('attribute unchanged produces no SET_ATTRIBUTE mutation', () => {
      game._ctx.classRegistry.set('TokenPiece', TokenPiece);
      const token = board.create(TokenPiece, 'warrior');

      const event = game.animate('noop', {}, () => {
        // Read but don't change
        const _h = token.health;
      });

      const attrMutations = event.mutations!.filter(m => m.type === 'SET_ATTRIBUTE');
      expect(attrMutations).toHaveLength(0);
    });
  });

  // =============================================
  // Mixed mutations
  // =============================================

  describe('mixed mutations', () => {
    it('animate() captures all mutation types in one callback', () => {
      game._ctx.classRegistry.set('TokenPiece', TokenPiece);
      const token = board.create(TokenPiece, 'warrior');

      const event = game.animate('complex', {}, () => {
        // CREATE
        board.create(Piece, 'newPiece');
        // MOVE
        piece.putInto(hand);
        // SET_ATTRIBUTE
        token.health = 1;
        // SET_PROPERTY
        game.score = 50;
      });

      const types = event.mutations!.map(m => m.type);
      expect(types).toContain('CREATE');
      expect(types).toContain('MOVE');
      expect(types).toContain('SET_ATTRIBUTE');
      expect(types).toContain('SET_PROPERTY');
    });

    it('mutations apply immediately to game state', () => {
      game.animate('move', {}, () => {
        piece.putInto(hand);
        // Piece is immediately in hand
        expect(piece._t.parent).toBe(hand);
        expect(hand._t.children).toContain(piece);
      });

      // After animate(), piece is still in hand
      expect(piece._t.parent).toBe(hand);
    });
  });

  // =============================================
  // Edge cases
  // =============================================

  describe('edge cases', () => {
    it('animate() with no mutations produces event with empty mutations array', () => {
      const event = game.animate('noop', {}, () => {
        // Read state but mutate nothing
        const _s = game.score;
        const _p = piece._t.parent;
      });

      expect(event.mutations).toEqual([]);
    });

    it('callback exception does not leak capture context', () => {
      try {
        game.animate('error', {}, () => {
          piece.putInto(hand);
          throw new Error('kaboom');
        });
      } catch {
        // expected
      }

      // _captureContext is null after error
      expect(game._captureContext).toBeNull();

      // Subsequent putInto() outside animate produces no mutation recording
      const piece2 = board.create(Piece, 'token2');
      piece2.putInto(hand);
      expect(game.pendingAnimationEvents).toHaveLength(0);
    });

    it('multiple animate() calls maintain monotonic IDs', () => {
      const e1 = game.animate('a', {}, () => { piece.putInto(hand); });
      piece.putInto(board); // move back for next animate
      const e2 = game.animate('b', {}, () => { piece.putInto(hand); });
      piece.putInto(board); // move back
      const e3 = game.animate('c', {}, () => { piece.putInto(hand); });
      piece.putInto(board); // move back
      const e4 = game.animate('d', {}, () => { piece.putInto(hand); });

      expect(e1.id).toBe(1);
      expect(e2.id).toBe(2);
      expect(e3.id).toBe(3);
      expect(e4.id).toBe(4);

      // All IDs strictly increasing
      const ids = [e1.id, e2.id, e3.id, e4.id];
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i]).toBeGreaterThan(ids[i - 1]);
      }
    });

    it('created element attributes are not double-counted as SET_ATTRIBUTE', () => {
      game._ctx.classRegistry.set('TokenPiece', TokenPiece);

      const event = game.animate('spawn', {}, () => {
        board.create(TokenPiece, 'warrior', { health: 20 });
      });

      // Should have CREATE but NOT SET_ATTRIBUTE for the new element's health
      const createMutations = event.mutations!.filter(m => m.type === 'CREATE');
      const attrMutations = event.mutations!.filter(m => m.type === 'SET_ATTRIBUTE');
      expect(createMutations).toHaveLength(1);
      // New elements weren't in the before snapshot so they can't produce attribute diffs
      expect(attrMutations).toHaveLength(0);
    });
  });
});
