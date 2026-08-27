import { describe, it, expect, beforeEach } from 'vitest';
import { executeCommand, undoCommand } from './executor.js';
import { createInverseCommand } from './inverse.js';
import type { GameCommand } from './types.js';
import { Game, Space, Piece, Player, MonotonicTrack } from '../index.js';

class TestPiece extends Piece<TestGame> {
  value: number = 0;
}

class TestSpace extends Space<TestGame> {}

class TrackPlayer extends Player {
  score = new MonotonicTrack({ id: 'score', direction: 'increasing', maxEntries: 5 });

  getTrack(trackId: string) {
    return trackId === 'score' ? this.score : undefined;
  }
}

class TestGame extends Game<TestGame, Player> {}

class TrackGame extends Game<TrackGame, TrackPlayer> {
  static PlayerClass = TrackPlayer;
}

describe('executeCommand', () => {
  let game: TestGame;
  let board: TestSpace;
  let hand: TestSpace;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    board = game.create(TestSpace, 'board');
    hand = game.create(TestSpace, 'hand');
    // Registers TestPiece under its class name so CREATE/CREATE_MANY can resolve it.
    board.create(TestPiece, 'seed').remove();
  });

  it('rejects an unknown command type with an error naming the type', () => {
    const result = executeCommand(game, { type: 'NOT_A_COMMAND' } as unknown as GameCommand);
    expect(result.success).toBe(false);
    expect(result.error).toContain('NOT_A_COMMAND');
  });

  it('converts a thrown error into a failed result instead of propagating', () => {
    const exploding = board.create(TestPiece, 'boom');
    Object.defineProperty(exploding, 'value', {
      set() {
        throw new Error('attribute is read-only');
      },
    });
    const result = executeCommand(game, {
      type: 'SET_ATTRIBUTE',
      elementId: exploding.id,
      attribute: 'value',
      value: 1,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('attribute is read-only');
  });

  describe('CREATE', () => {
    it('creates an element under the named parent', () => {
      const result = executeCommand(game, {
        type: 'CREATE',
        parentId: board.id,
        className: 'TestPiece',
        name: 'pawn',
        attributes: { value: 7 },
      });
      expect(result.success).toBe(true);
      const created = board.all(TestPiece)[0];
      expect(created.name).toBe('pawn');
      expect(created.value).toBe(7);
    });

    it('fails with the missing parent id when the parent is gone', () => {
      const result = executeCommand(game, {
        type: 'CREATE',
        parentId: 99999,
        className: 'TestPiece',
        name: 'pawn',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('99999');
    });

    it('fails with the class name when the class is not registered', () => {
      const result = executeCommand(game, {
        type: 'CREATE',
        parentId: board.id,
        className: 'NeverRegistered',
        name: 'pawn',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('NeverRegistered');
    });
  });

  describe('CREATE_MANY', () => {
    it('creates the requested count', () => {
      const result = executeCommand(game, {
        type: 'CREATE_MANY',
        parentId: board.id,
        className: 'TestPiece',
        name: 'token',
        count: 3,
      });
      expect(result.success).toBe(true);
      expect(board.all(TestPiece)).toHaveLength(3);
    });

    it('applies per-element attributes positionally', () => {
      executeCommand(game, {
        type: 'CREATE_MANY',
        parentId: board.id,
        className: 'TestPiece',
        name: 'token',
        count: 3,
        attributesList: [{ value: 1 }, { value: 2 }, { value: 3 }],
      });
      expect(board.all(TestPiece).map((p) => p.value)).toEqual([1, 2, 3]);
    });

    it('defaults attributes for indexes the list does not cover', () => {
      executeCommand(game, {
        type: 'CREATE_MANY',
        parentId: board.id,
        className: 'TestPiece',
        name: 'token',
        count: 2,
        attributesList: [{ value: 5 }],
      });
      expect(board.all(TestPiece).map((p) => p.value)).toEqual([5, 0]);
    });

    it('creates nothing for a count of zero', () => {
      const result = executeCommand(game, {
        type: 'CREATE_MANY',
        parentId: board.id,
        className: 'TestPiece',
        name: 'token',
        count: 0,
      });
      expect(result.success).toBe(true);
      expect(board.all(TestPiece)).toHaveLength(0);
    });
  });

  describe('MOVE', () => {
    it('reparents the element', () => {
      const piece = board.create(TestPiece, 'p');
      const result = executeCommand(game, {
        type: 'MOVE',
        elementId: piece.id,
        destinationId: hand.id,
      });
      expect(result.success).toBe(true);
      expect(piece.parent).toBe(hand);
    });

    it("honours position 'first'", () => {
      const a = hand.create(TestPiece, 'a');
      const b = board.create(TestPiece, 'b');
      executeCommand(game, {
        type: 'MOVE',
        elementId: b.id,
        destinationId: hand.id,
        position: 'first',
      });
      expect(hand.all(TestPiece).map((p) => p.name)).toEqual(['b', 'a']);
      expect(a.parent).toBe(hand);
    });

    it('fails when the element is missing', () => {
      const result = executeCommand(game, {
        type: 'MOVE',
        elementId: 99999,
        destinationId: hand.id,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('99999');
    });

    it('fails when the destination is missing', () => {
      const piece = board.create(TestPiece, 'p');
      const result = executeCommand(game, {
        type: 'MOVE',
        elementId: piece.id,
        destinationId: 99999,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Destination');
      expect(piece.parent).toBe(board);
    });
  });

  describe('REMOVE', () => {
    it('moves the element to the pile rather than deleting it', () => {
      const piece = board.create(TestPiece, 'p');
      const result = executeCommand(game, { type: 'REMOVE', elementId: piece.id });
      expect(result.success).toBe(true);
      expect(board.all(TestPiece)).toHaveLength(0);
      expect(game.getElementById(piece.id)).toBe(piece);
    });

    it('fails when the element is missing', () => {
      const result = executeCommand(game, { type: 'REMOVE', elementId: 99999 });
      expect(result.success).toBe(false);
    });
  });

  describe('SHUFFLE', () => {
    it('keeps every child, only reorders', () => {
      for (let i = 0; i < 20; i++) board.create(TestPiece, `p${i}`, { value: i });
      const result = executeCommand(game, { type: 'SHUFFLE', spaceId: board.id });
      expect(result.success).toBe(true);
      expect(board.all(TestPiece).map((p) => p.value).sort((a, b) => a - b))
        .toEqual(Array.from({ length: 20 }, (_, i) => i));
    });

    it('fails when the space is missing', () => {
      const result = executeCommand(game, { type: 'SHUFFLE', spaceId: 99999 });
      expect(result.success).toBe(false);
    });
  });

  describe('SET_ATTRIBUTE', () => {
    it('writes the attribute', () => {
      const piece = board.create(TestPiece, 'p', { value: 1 });
      const result = executeCommand(game, {
        type: 'SET_ATTRIBUTE',
        elementId: piece.id,
        attribute: 'value',
        value: 42,
      });
      expect(result.success).toBe(true);
      expect(piece.value).toBe(42);
    });

    it('fails when the element is missing', () => {
      const result = executeCommand(game, {
        type: 'SET_ATTRIBUTE',
        elementId: 99999,
        attribute: 'value',
        value: 1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('SET_VISIBILITY', () => {
    it('accepts a bare mode string', () => {
      const piece = board.create(TestPiece, 'p');
      const result = executeCommand(game, {
        type: 'SET_VISIBILITY',
        elementId: piece.id,
        visibility: 'hidden',
      });
      expect(result.success).toBe(true);
      expect(piece.getEffectiveVisibility()).toEqual({ mode: 'hidden', explicit: true });
    });

    it('accepts a full config with grant lists', () => {
      const piece = board.create(TestPiece, 'p');
      executeCommand(game, {
        type: 'SET_VISIBILITY',
        elementId: piece.id,
        visibility: { mode: 'hidden', addPlayers: [1] },
      });
      expect(piece.isVisibleTo(0)).toBe(false);
      expect(piece.isVisibleTo(1)).toBe(true);
    });

    it('marks the result explicit so it survives zone inheritance', () => {
      const piece = board.create(TestPiece, 'p');
      executeCommand(game, {
        type: 'SET_VISIBILITY',
        elementId: piece.id,
        visibility: 'all',
      });
      expect(piece.getEffectiveVisibility().explicit).toBe(true);
    });

    it('fails when the element is missing', () => {
      const result = executeCommand(game, {
        type: 'SET_VISIBILITY',
        elementId: 99999,
        visibility: 'hidden',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ADD_VISIBLE_TO', () => {
    it('grants sight to the named seats', () => {
      const piece = board.create(TestPiece, 'p');
      executeCommand(game, { type: 'SET_VISIBILITY', elementId: piece.id, visibility: 'hidden' });
      const result = executeCommand(game, {
        type: 'ADD_VISIBLE_TO',
        elementId: piece.id,
        players: [1],
      });
      expect(result.success).toBe(true);
      expect(piece.isVisibleTo(1)).toBe(true);
      expect(piece.isVisibleTo(0)).toBe(false);
    });

    it('is additive and de-duplicated across calls', () => {
      const piece = board.create(TestPiece, 'p');
      executeCommand(game, { type: 'SET_VISIBILITY', elementId: piece.id, visibility: 'hidden' });
      executeCommand(game, { type: 'ADD_VISIBLE_TO', elementId: piece.id, players: [1] });
      executeCommand(game, { type: 'ADD_VISIBLE_TO', elementId: piece.id, players: [1, 0] });
      expect(piece.getEffectiveVisibility().addPlayers).toEqual([1, 0]);
    });

    it('fails when the element is missing', () => {
      const result = executeCommand(game, {
        type: 'ADD_VISIBLE_TO',
        elementId: 99999,
        players: [0],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('SET_CURRENT_PLAYER', () => {
    it('moves the turn to the named seat', () => {
      const result = executeCommand(game, { type: 'SET_CURRENT_PLAYER', playerPosition: 1 });
      expect(result.success).toBe(true);
      expect(game.currentPlayer?.seat).toBe(1);
    });
  });

  describe('MESSAGE', () => {
    it('appends a public message to the log', () => {
      const result = executeCommand(game, { type: 'MESSAGE', text: 'hello' });
      expect(result.success).toBe(true);
      expect(game.messages.at(-1)).toEqual({ text: 'hello', data: undefined });
    });

    it('refuses a reserved property, the other door into element identity (#52)', () => {
      // `create()` already refuses these (#49); a SET_ATTRIBUTE command is the
      // other way in, and `id` is what every reference and snapshot entry keys on.
      const element = game;
      for (const key of ['id', '_t', '_ctx']) {
        const result = executeCommand(game, {
          type: 'SET_ATTRIBUTE',
          elementId: element.id,
          attribute: key,
          value: 999,
        } as never);
        expect(result.success, key).toBe(false);
        expect(result.error, key).toMatch(/reserved/i);
      }
      // And the identity it was aimed at is untouched.
      expect(typeof element.id).toBe('number');
    });

    it('carries the audience for a private message', () => {
      executeCommand(game, { type: 'MESSAGE', text: 'psst', to: [1] });
      expect(game.messages.at(-1)?.to).toEqual([1]);
    });

    it('carries the data payload', () => {
      executeCommand(game, { type: 'MESSAGE', text: 'scored', data: { points: 3 } });
      expect(game.messages.at(-1)?.data).toEqual({ points: 3 });
    });
  });

  describe('START_GAME', () => {
    it('moves the game out of setup', () => {
      const result = executeCommand(game, { type: 'START_GAME' });
      expect(result.success).toBe(true);
      expect(game.phase).toBe('started');
    });

    it('refuses to start a game twice', () => {
      executeCommand(game, { type: 'START_GAME' });
      const second = executeCommand(game, { type: 'START_GAME' });
      expect(second.success).toBe(false);
      expect(second.error).toContain('already started');
      expect(game.phase).toBe('started');
    });
  });

  describe('END_GAME', () => {
    it('finishes the game', () => {
      const result = executeCommand(game, { type: 'END_GAME' });
      expect(result.success).toBe(true);
      expect(game.phase).toBe('finished');
    });

    it('records the winners when given', () => {
      executeCommand(game, { type: 'END_GAME', winners: [1] });
      expect(game.settings.winners).toEqual([1]);
    });

    it('leaves winners alone when not given', () => {
      executeCommand(game, { type: 'END_GAME' });
      expect(game.settings.winners).toBeUndefined();
    });
  });

  describe('SET_ORDER / RESTORE_ORDER / REORDER_CHILD', () => {
    it('SET_ORDER writes the space order mode', () => {
      const result = executeCommand(game, { type: 'SET_ORDER', spaceId: board.id, order: 'stacking' });
      expect(result.success).toBe(true);
      expect(board._t.order).toBe('stacking');
    });

    it('SET_ORDER fails when the space is missing', () => {
      expect(executeCommand(game, { type: 'SET_ORDER', spaceId: 99999, order: 'normal' }).success)
        .toBe(false);
    });

    it('RESTORE_ORDER puts children back in the exact listed order', () => {
      const pieces = ['a', 'b', 'c'].map((n) => board.create(TestPiece, n));
      const reversed = [...pieces].reverse().map((p) => p.id);
      const result = executeCommand(game, {
        type: 'RESTORE_ORDER',
        spaceId: board.id,
        elementIds: reversed,
      });
      expect(result.success).toBe(true);
      expect(board.all(TestPiece).map((p) => p.name)).toEqual(['c', 'b', 'a']);
    });

    it('RESTORE_ORDER refuses a child-count mismatch rather than half-applying', () => {
      const pieces = ['a', 'b', 'c'].map((n) => board.create(TestPiece, n));
      const result = executeCommand(game, {
        type: 'RESTORE_ORDER',
        spaceId: board.id,
        elementIds: [pieces[0].id, pieces[1].id],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('expected 2 children but found 3');
      expect(board.all(TestPiece).map((p) => p.name)).toEqual(['a', 'b', 'c']);
    });

    it('RESTORE_ORDER refuses an id that is no longer a child', () => {
      const pieces = ['a', 'b'].map((n) => board.create(TestPiece, n));
      const stranger = hand.create(TestPiece, 'x');
      const result = executeCommand(game, {
        type: 'RESTORE_ORDER',
        spaceId: board.id,
        elementIds: [pieces[0].id, stranger.id],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain(`element ${stranger.id} is no longer a child`);
      expect(board.all(TestPiece).map((p) => p.name)).toEqual(['a', 'b']);
    });

    it('REORDER_CHILD moves a child to the target index', () => {
      const pieces = ['a', 'b', 'c'].map((n) => board.create(TestPiece, n));
      const result = executeCommand(game, {
        type: 'REORDER_CHILD',
        elementId: pieces[2].id,
        targetIndex: 0,
      });
      expect(result.success).toBe(true);
      expect(board.all(TestPiece).map((p) => p.name)).toEqual(['c', 'a', 'b']);
    });

    it('REORDER_CHILD rejects an out-of-range index without disturbing the order', () => {
      const pieces = ['a', 'b'].map((n) => board.create(TestPiece, n));
      for (const targetIndex of [-1, 2]) {
        const result = executeCommand(game, {
          type: 'REORDER_CHILD',
          elementId: pieces[0].id,
          targetIndex,
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid target index');
      }
      expect(board.all(TestPiece).map((p) => p.name)).toEqual(['a', 'b']);
    });

    it('REORDER_CHILD fails for an element with no parent', () => {
      const result = executeCommand(game, {
        type: 'REORDER_CHILD',
        elementId: game.id,
        targetIndex: 0,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('no parent');
    });
  });

  describe('TRACK_ADD / TRACK_REMOVE_LAST', () => {
    let trackGame: TrackGame;
    let owner: TrackPlayer;

    const add = (value: number, extra: Record<string, unknown> = {}) =>
      executeCommand(trackGame as unknown as Game, {
        type: 'TRACK_ADD', ownerId: owner.id, trackId: 'score', value, ...extra,
      } as GameCommand);

    beforeEach(() => {
      trackGame = new TrackGame({ playerCount: 2 });
      owner = trackGame.players[0];
    });

    it('adds an entry to the named track', () => {
      const result = add(5);
      expect(result.success).toBe(true);
      expect(owner.score.getEntries().map((e) => e.value)).toEqual([5]);
    });

    it('carries the isSpecial flag', () => {
      add(5, { isSpecial: true });
      expect(owner.score.getLastEntry()?.isSpecial).toBe(true);
    });

    it('turns a track rule violation into a failed result, not a throw', () => {
      add(5);
      // The track is strictly increasing, so 1 breaks its rule.
      const result = add(1);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot add value 1');
      expect(owner.score.getEntries()).toHaveLength(1);
    });

    it('fails with a clear error when the owner does not support tracks', () => {
      const result = executeCommand(trackGame as unknown as Game, {
        type: 'TRACK_ADD',
        ownerId: trackGame.id,
        trackId: 'score',
        value: 1,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not support tracks');
    });

    it('fails when the track id is unknown', () => {
      const result = executeCommand(trackGame as unknown as Game, {
        type: 'TRACK_ADD',
        ownerId: owner.id,
        trackId: 'nope',
        value: 1,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('nope');
    });

    it('fails when the owner id does not resolve', () => {
      const result = executeCommand(trackGame as unknown as Game, {
        type: 'TRACK_ADD',
        ownerId: 99999,
        trackId: 'score',
        value: 1,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('99999');
    });

    it('removes the last entry', () => {
      add(3);
      add(7);
      const result = executeCommand(trackGame as unknown as Game, {
        type: 'TRACK_REMOVE_LAST', ownerId: owner.id, trackId: 'score',
      });
      expect(result.success).toBe(true);
      expect(owner.score.getEntries().map((e) => e.value)).toEqual([3]);
    });

    it('TRACK_REMOVE_LAST on an empty track is a no-op, not a failure', () => {
      const result = executeCommand(trackGame as unknown as Game, {
        type: 'TRACK_REMOVE_LAST', ownerId: owner.id, trackId: 'score',
      });
      expect(result.success).toBe(true);
      expect(owner.score.getEntries()).toHaveLength(0);
    });

    it('TRACK_REMOVE_LAST fails when the owner does not support tracks', () => {
      const result = executeCommand(trackGame as unknown as Game, {
        type: 'TRACK_REMOVE_LAST', ownerId: trackGame.id, trackId: 'score',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not support tracks');
    });
  });

  describe('ANIMATE', () => {
    it('pushes an animation event onto the pending buffer', () => {
      const result = executeCommand(game, {
        type: 'ANIMATE',
        eventType: 'card-flip',
        data: { cardId: 3 },
      });
      expect(result.success).toBe(true);
      const event = game.pendingAnimationEvents.at(-1);
      expect(event?.type).toBe('card-flip');
      expect(event?.data).toEqual({ cardId: 3 });
    });
  });
});

describe('undoCommand', () => {
  let game: TestGame;
  let board: TestSpace;
  let hand: TestSpace;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
    board = game.create(TestSpace, 'board');
    hand = game.create(TestSpace, 'hand');
  });

  it('reports a non-invertible command instead of silently doing nothing', () => {
    const result = undoCommand(game, { type: 'MESSAGE', text: 'hi' }, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('MESSAGE');
    expect(result.error).toContain('not invertible');
  });

  it('rolls a MOVE back to the original parent', () => {
    const piece = board.create(TestPiece, 'p');
    const command: GameCommand = {
      type: 'MOVE',
      elementId: piece.id,
      destinationId: hand.id,
    };
    const inverse = createInverseCommand(game, command);
    executeCommand(game, command);
    expect(piece.parent).toBe(hand);

    const result = undoCommand(game, command, inverse);
    expect(result.success).toBe(true);
    expect(piece.parent).toBe(board);
  });

  it('rolls a SET_ATTRIBUTE back to the prior value', () => {
    const piece = board.create(TestPiece, 'p', { value: 10 });
    const command: GameCommand = {
      type: 'SET_ATTRIBUTE',
      elementId: piece.id,
      attribute: 'value',
      value: 99,
    };
    const inverse = createInverseCommand(game, command);
    executeCommand(game, command);
    undoCommand(game, command, inverse);
    expect(piece.value).toBe(10);
  });

  it('propagates the inverse failure rather than reporting a bogus success', () => {
    const command: GameCommand = {
      type: 'MOVE', elementId: 1, destinationId: hand.id,
    };
    // An inverse whose element no longer resolves must surface as a failure.
    const result = undoCommand(game, command, {
      type: 'MOVE', elementId: 99999, destinationId: board.id,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('99999');
  });
});
