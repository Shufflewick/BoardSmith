import { describe, it, expect, beforeEach } from 'vitest';
import { createInverseCommand } from './inverse.js';
import { executeCommand } from './executor.js';
import type { GameCommand } from './types.js';
import { Game, Space, Piece, Player, MonotonicTrack } from '../index.js';

class TestPiece extends Piece<TestGame> {
  value: number = 0;
}

class TestSpace extends Space<TestGame> {}

class TestGame extends Game<TestGame, Player> {}

class TrackPlayer extends Player {
  score = new MonotonicTrack({ id: 'score', direction: 'increasing', maxEntries: 5 });

  getTrack(trackId: string) {
    return trackId === 'score' ? this.score : undefined;
  }
}

class TrackGame extends Game<TrackGame, TrackPlayer> {
  static PlayerClass = TrackPlayer;
}

describe('createInverseCommand', () => {
  let game: TestGame;
  let board: TestSpace;
  let hand: TestSpace;

  /** Capture the inverse first (its contract), run the command, then roll it back. */
  const roundTrip = (command: GameCommand): void => {
    const inverse = createInverseCommand(game, command);
    expect(inverse).not.toBeNull();
    expect(executeCommand(game, command).success).toBe(true);
    expect(executeCommand(game, inverse!).success).toBe(true);
  };

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    board = game.create(TestSpace, 'board');
    hand = game.create(TestSpace, 'hand');
  });

  describe('commands that are not invertible', () => {
    it.each([
      ['CREATE', { type: 'CREATE', parentId: 1, className: 'TestPiece', name: 'p' }],
      ['CREATE_MANY', { type: 'CREATE_MANY', parentId: 1, className: 'TestPiece', name: 'p', count: 2 }],
      ['ADD_VISIBLE_TO', { type: 'ADD_VISIBLE_TO', elementId: 1, players: [1] }],
      ['MESSAGE', { type: 'MESSAGE', text: 'hi' }],
      ['ANIMATE', { type: 'ANIMATE', eventType: 'flip', data: {} }],
      ['START_GAME', { type: 'START_GAME' }],
      ['END_GAME', { type: 'END_GAME' }],
    ] as const)('returns null for %s', (_name, command) => {
      expect(createInverseCommand(game, command as GameCommand)).toBeNull();
    });

    it('returns null for an unrecognised command type', () => {
      expect(createInverseCommand(game, { type: 'WAT' } as unknown as GameCommand)).toBeNull();
    });
  });

  describe('MOVE', () => {
    it('captures the parent the element is in right now', () => {
      const piece = board.create(TestPiece, 'p');
      expect(createInverseCommand(game, {
        type: 'MOVE', elementId: piece.id, destinationId: hand.id,
      })).toEqual({
        type: 'MOVE', elementId: piece.id, destinationId: board.id, position: 'first',
      });
    });

    it("records position 'last' for an element that is not first in its parent", () => {
      board.create(TestPiece, 'a');
      const piece = board.create(TestPiece, 'b');
      const inverse = createInverseCommand(game, {
        type: 'MOVE', elementId: piece.id, destinationId: hand.id,
      });
      expect(inverse).toMatchObject({ position: 'last' });
    });

    it('round-trips back to the original parent', () => {
      const piece = board.create(TestPiece, 'p');
      roundTrip({ type: 'MOVE', elementId: piece.id, destinationId: hand.id });
      expect(piece.parent).toBe(board);
    });

    it('restores the leading position of a first child', () => {
      const first = board.create(TestPiece, 'a');
      board.create(TestPiece, 'b');
      roundTrip({ type: 'MOVE', elementId: first.id, destinationId: hand.id });
      expect(board.all(TestPiece).map((p) => p.name)).toEqual(['a', 'b']);
    });

    it('returns null when the element does not exist', () => {
      expect(createInverseCommand(game, {
        type: 'MOVE', elementId: 99999, destinationId: hand.id,
      })).toBeNull();
    });

    it('returns null for a root element with no parent', () => {
      expect(createInverseCommand(game, {
        type: 'MOVE', elementId: game.id, destinationId: hand.id,
      })).toBeNull();
    });
  });

  describe('SET_ATTRIBUTE', () => {
    it('captures the value in place before the write', () => {
      const piece = board.create(TestPiece, 'p', { value: 10 });
      expect(createInverseCommand(game, {
        type: 'SET_ATTRIBUTE', elementId: piece.id, attribute: 'value', value: 99,
      })).toEqual({
        type: 'SET_ATTRIBUTE', elementId: piece.id, attribute: 'value', value: 10,
      });
    });

    it('round-trips to the original value', () => {
      const piece = board.create(TestPiece, 'p', { value: 10 });
      roundTrip({ type: 'SET_ATTRIBUTE', elementId: piece.id, attribute: 'value', value: 99 });
      expect(piece.value).toBe(10);
    });

    it('captures undefined for an attribute that was never set', () => {
      const piece = board.create(TestPiece, 'p');
      const inverse = createInverseCommand(game, {
        type: 'SET_ATTRIBUTE', elementId: piece.id, attribute: 'brandNew', value: 1,
      });
      expect(inverse).toEqual({
        type: 'SET_ATTRIBUTE', elementId: piece.id, attribute: 'brandNew', value: undefined,
      });
    });

    it('returns null when the element does not exist', () => {
      expect(createInverseCommand(game, {
        type: 'SET_ATTRIBUTE', elementId: 99999, attribute: 'value', value: 1,
      })).toBeNull();
    });
  });

  describe('REMOVE', () => {
    it('inverts to a MOVE back to the current parent, not a re-CREATE', () => {
      const piece = board.create(TestPiece, 'p');
      expect(createInverseCommand(game, { type: 'REMOVE', elementId: piece.id })).toEqual({
        type: 'MOVE', elementId: piece.id, destinationId: board.id, position: 'first',
      });
    });

    it('round-trips the element out of the pile and back onto the board', () => {
      const piece = board.create(TestPiece, 'p');
      roundTrip({ type: 'REMOVE', elementId: piece.id });
      expect(piece.parent).toBe(board);
      expect(board.all(TestPiece)).toHaveLength(1);
    });

    it('returns null when the element does not exist', () => {
      expect(createInverseCommand(game, { type: 'REMOVE', elementId: 99999 })).toBeNull();
    });
  });

  describe('SHUFFLE', () => {
    it('captures the pre-shuffle order as a RESTORE_ORDER command', () => {
      const ids = ['a', 'b', 'c'].map((n) => board.create(TestPiece, n).id);
      expect(createInverseCommand(game, { type: 'SHUFFLE', spaceId: board.id })).toEqual({
        type: 'RESTORE_ORDER', spaceId: board.id, elementIds: ids,
      });
    });

    it('round-trips a shuffled deck back to its exact original order', () => {
      const names = Array.from({ length: 20 }, (_, i) => `c${i}`);
      for (const n of names) board.create(TestPiece, n);
      roundTrip({ type: 'SHUFFLE', spaceId: board.id });
      expect(board.all(TestPiece).map((p) => p.name)).toEqual(names);
    });

    it('returns null when the space does not exist', () => {
      expect(createInverseCommand(game, { type: 'SHUFFLE', spaceId: 99999 })).toBeNull();
    });

    it('snapshots the ids so a later shuffle cannot rewrite the captured order', () => {
      const ids = ['a', 'b', 'c'].map((n) => board.create(TestPiece, n).id);
      const inverse = createInverseCommand(game, { type: 'SHUFFLE', spaceId: board.id })!;
      executeCommand(game, { type: 'SHUFFLE', spaceId: board.id });
      expect((inverse as { elementIds: number[] }).elementIds).toEqual(ids);
    });
  });

  describe('SET_VISIBILITY', () => {
    it('captures the effective mode in force before the change', () => {
      const piece = board.create(TestPiece, 'p');
      executeCommand(game, { type: 'SET_VISIBILITY', elementId: piece.id, visibility: 'owner' });
      expect(createInverseCommand(game, {
        type: 'SET_VISIBILITY', elementId: piece.id, visibility: 'hidden',
      })).toEqual({
        type: 'SET_VISIBILITY', elementId: piece.id, visibility: 'owner',
      });
    });

    it('round-trips back to the original mode', () => {
      const piece = board.create(TestPiece, 'p');
      roundTrip({ type: 'SET_VISIBILITY', elementId: piece.id, visibility: 'hidden' });
      expect(piece.getEffectiveVisibility().mode).toBe('all');
    });

    it('returns null when the element does not exist', () => {
      expect(createInverseCommand(game, {
        type: 'SET_VISIBILITY', elementId: 99999, visibility: 'hidden',
      })).toBeNull();
    });
  });

  describe('SET_CURRENT_PLAYER', () => {
    it('captures the seat holding the turn right now', () => {
      const current = game.currentPlayer!.seat;
      expect(createInverseCommand(game, { type: 'SET_CURRENT_PLAYER', playerPosition: 2 })).toEqual({
        type: 'SET_CURRENT_PLAYER', playerPosition: current,
      });
    });

    it('round-trips the turn back to the original seat', () => {
      const current = game.currentPlayer!.seat;
      roundTrip({ type: 'SET_CURRENT_PLAYER', playerPosition: 2 });
      expect(game.currentPlayer?.seat).toBe(current);
    });
  });

  describe('SET_ORDER', () => {
    it('captures the current order mode', () => {
      expect(createInverseCommand(game, {
        type: 'SET_ORDER', spaceId: board.id, order: 'stacking',
      })).toEqual({ type: 'SET_ORDER', spaceId: board.id, order: 'normal' });
    });

    it('round-trips back to the prior mode', () => {
      executeCommand(game, { type: 'SET_ORDER', spaceId: board.id, order: 'stacking' });
      roundTrip({ type: 'SET_ORDER', spaceId: board.id, order: 'normal' });
      expect(board._t.order).toBe('stacking');
    });

    it('returns null when the space does not exist', () => {
      expect(createInverseCommand(game, {
        type: 'SET_ORDER', spaceId: 99999, order: 'normal',
      })).toBeNull();
    });
  });

  describe('REORDER_CHILD', () => {
    it('captures the current index', () => {
      const pieces = ['a', 'b', 'c'].map((n) => board.create(TestPiece, n));
      expect(createInverseCommand(game, {
        type: 'REORDER_CHILD', elementId: pieces[2].id, targetIndex: 0,
      })).toEqual({ type: 'REORDER_CHILD', elementId: pieces[2].id, targetIndex: 2 });
    });

    it('round-trips the child back to where it started', () => {
      const pieces = ['a', 'b', 'c'].map((n) => board.create(TestPiece, n));
      roundTrip({ type: 'REORDER_CHILD', elementId: pieces[2].id, targetIndex: 0 });
      expect(board.all(TestPiece).map((p) => p.name)).toEqual(['a', 'b', 'c']);
    });

    it('returns null when the element does not exist', () => {
      expect(createInverseCommand(game, {
        type: 'REORDER_CHILD', elementId: 99999, targetIndex: 0,
      })).toBeNull();
    });

    it('returns null for an element with no parent', () => {
      expect(createInverseCommand(game, {
        type: 'REORDER_CHILD', elementId: game.id, targetIndex: 0,
      })).toBeNull();
    });
  });

  describe('track commands', () => {
    let trackGame: TrackGame;
    let owner: TrackPlayer;

    beforeEach(() => {
      trackGame = new TrackGame({ playerCount: 2 });
      owner = trackGame.players[0];
    });

    it('inverts TRACK_ADD to TRACK_REMOVE_LAST without touching the game', () => {
      expect(createInverseCommand(trackGame as unknown as Game, {
        type: 'TRACK_ADD', ownerId: owner.id, trackId: 'score', value: 4,
      })).toEqual({ type: 'TRACK_REMOVE_LAST', ownerId: owner.id, trackId: 'score' });
    });

    it('round-trips a TRACK_ADD', () => {
      const command: GameCommand = {
        type: 'TRACK_ADD', ownerId: owner.id, trackId: 'score', value: 4,
      };
      const inverse = createInverseCommand(trackGame as unknown as Game, command)!;
      executeCommand(trackGame as unknown as Game, command);
      executeCommand(trackGame as unknown as Game, inverse);
      expect(owner.score.getEntries()).toHaveLength(0);
    });

    it('inverts TRACK_REMOVE_LAST by capturing the entry about to be dropped', () => {
      executeCommand(trackGame as unknown as Game, {
        type: 'TRACK_ADD', ownerId: owner.id, trackId: 'score', value: 4, isSpecial: true,
      });
      expect(createInverseCommand(trackGame as unknown as Game, {
        type: 'TRACK_REMOVE_LAST', ownerId: owner.id, trackId: 'score',
      })).toEqual({
        type: 'TRACK_ADD', ownerId: owner.id, trackId: 'score', value: 4, isSpecial: true,
      });
    });

    it('round-trips a TRACK_REMOVE_LAST', () => {
      executeCommand(trackGame as unknown as Game, {
        type: 'TRACK_ADD', ownerId: owner.id, trackId: 'score', value: 4,
      });
      const command: GameCommand = {
        type: 'TRACK_REMOVE_LAST', ownerId: owner.id, trackId: 'score',
      };
      const inverse = createInverseCommand(trackGame as unknown as Game, command)!;
      executeCommand(trackGame as unknown as Game, command);
      executeCommand(trackGame as unknown as Game, inverse);
      expect(owner.score.getEntries().map((e) => e.value)).toEqual([4]);
    });

    it('returns null for TRACK_REMOVE_LAST on an empty track', () => {
      expect(createInverseCommand(trackGame as unknown as Game, {
        type: 'TRACK_REMOVE_LAST', ownerId: owner.id, trackId: 'score',
      })).toBeNull();
    });

    it('returns null for TRACK_REMOVE_LAST when the owner supports no tracks', () => {
      expect(createInverseCommand(trackGame as unknown as Game, {
        type: 'TRACK_REMOVE_LAST', ownerId: trackGame.id, trackId: 'score',
      })).toBeNull();
    });

    it('returns null for TRACK_REMOVE_LAST when the track id is unknown', () => {
      expect(createInverseCommand(trackGame as unknown as Game, {
        type: 'TRACK_REMOVE_LAST', ownerId: owner.id, trackId: 'nope',
      })).toBeNull();
    });

    it('returns null for TRACK_REMOVE_LAST when the owner does not resolve', () => {
      expect(createInverseCommand(trackGame as unknown as Game, {
        type: 'TRACK_REMOVE_LAST', ownerId: 99999, trackId: 'score',
      })).toBeNull();
    });
  });
});
