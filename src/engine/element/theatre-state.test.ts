import { describe, test, expect, beforeEach } from 'vitest';
import type { ElementJSON } from './types.js';
import type {
  MoveMutation,
  CreateMutation,
  SetAttributeMutation,
  SetPropertyMutation,
} from './mutation-capture.js';
import {
  findElementById,
  removeElementFromParent,
  applyMoveMutation,
  applyCreateMutation,
  applySetAttributeMutation,
  applySetPropertyMutation,
  applyMutation,
  applyMutations,
} from './theatre-state.js';
import { Game } from './game.js';
import { Space } from './space.js';
import { Piece } from './piece.js';
import { Player } from '../player/player.js';

/**
 * Create a fresh ElementJSON snapshot for testing.
 *
 * Structure:
 *   Game (id=0)
 *     Space "board" (id=1)
 *       Piece "warrior" (id=10, hp=5)
 *       Piece "mage" (id=11, hp=3)
 *     Space "discard" (id=2)
 *       (empty)
 */
function makeSnapshot(): ElementJSON {
  return {
    className: 'Game', id: 0, name: 'game',
    attributes: { score: 0, round: 1 },
    children: [
      {
        className: 'Space', id: 1, name: 'board',
        attributes: {},
        children: [
          { className: 'Piece', id: 10, name: 'warrior', attributes: { hp: 5 } },
          { className: 'Piece', id: 11, name: 'mage', attributes: { hp: 3 } },
        ],
      },
      {
        className: 'Space', id: 2, name: 'discard',
        attributes: {},
        children: [],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// findElementById
// ---------------------------------------------------------------------------

describe('findElementById', () => {
  test('finds root by id', () => {
    const snapshot = makeSnapshot();
    const found = findElementById(snapshot, 0);
    expect(found).toBe(snapshot);
  });

  test('finds direct child', () => {
    const snapshot = makeSnapshot();
    const found = findElementById(snapshot, 1);
    expect(found?.name).toBe('board');
  });

  test('finds deeply nested child', () => {
    const snapshot = makeSnapshot();
    const found = findElementById(snapshot, 10);
    expect(found?.name).toBe('warrior');
    expect(found?.attributes.hp).toBe(5);
  });

  test('returns undefined for non-existent id', () => {
    const snapshot = makeSnapshot();
    expect(findElementById(snapshot, 999)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// removeElementFromParent
// ---------------------------------------------------------------------------

describe('removeElementFromParent', () => {
  test('removes element from parent and returns it', () => {
    const snapshot = makeSnapshot();
    const removed = removeElementFromParent(snapshot, 10);
    expect(removed?.name).toBe('warrior');
    expect(removed?.id).toBe(10);
  });

  test('returns undefined when element not found', () => {
    const snapshot = makeSnapshot();
    expect(removeElementFromParent(snapshot, 999)).toBeUndefined();
  });

  test('element no longer in original parent after removal', () => {
    const snapshot = makeSnapshot();
    removeElementFromParent(snapshot, 10);
    const board = findElementById(snapshot, 1);
    expect(board?.children?.length).toBe(1);
    expect(board?.children?.[0].name).toBe('mage');
  });
});

// ---------------------------------------------------------------------------
// applyMoveMutation
// ---------------------------------------------------------------------------

describe('applyMoveMutation', () => {
  test('moves element between parents', () => {
    const snapshot = makeSnapshot();
    const mutation: MoveMutation = {
      type: 'MOVE',
      elementId: 10,
      fromParentId: 1,
      toParentId: 2,
    };
    applyMoveMutation(snapshot, mutation);

    const board = findElementById(snapshot, 1);
    const discard = findElementById(snapshot, 2);
    expect(board?.children?.length).toBe(1);
    expect(discard?.children?.length).toBe(1);
    expect(discard?.children?.[0].name).toBe('warrior');
  });

  test('moves element to first position when position is "first"', () => {
    const snapshot = makeSnapshot();
    // First move warrior to discard
    applyMoveMutation(snapshot, {
      type: 'MOVE', elementId: 10, fromParentId: 1, toParentId: 2,
    });
    // Then move mage to discard at first position
    applyMoveMutation(snapshot, {
      type: 'MOVE', elementId: 11, fromParentId: 1, toParentId: 2, position: 'first',
    });

    const discard = findElementById(snapshot, 2);
    expect(discard?.children?.length).toBe(2);
    expect(discard?.children?.[0].name).toBe('mage');
    expect(discard?.children?.[1].name).toBe('warrior');
  });

  test('removes element when destination parent not in snapshot (pile pattern)', () => {
    const snapshot = makeSnapshot();
    const mutation: MoveMutation = {
      type: 'MOVE',
      elementId: 10,
      fromParentId: 1,
      toParentId: 999, // not in snapshot -- pile pattern
    };
    applyMoveMutation(snapshot, mutation);

    const board = findElementById(snapshot, 1);
    expect(board?.children?.length).toBe(1);
    expect(board?.children?.[0].name).toBe('mage');
    // warrior is gone entirely
    expect(findElementById(snapshot, 10)).toBeUndefined();
  });

  test('source element no longer in original parent after move', () => {
    const snapshot = makeSnapshot();
    applyMoveMutation(snapshot, {
      type: 'MOVE', elementId: 10, fromParentId: 1, toParentId: 2,
    });
    const board = findElementById(snapshot, 1);
    const ids = board?.children?.map(c => c.id);
    expect(ids).toEqual([11]);
  });
});

// ---------------------------------------------------------------------------
// applyCreateMutation
// ---------------------------------------------------------------------------

describe('applyCreateMutation', () => {
  test('creates element in parent children', () => {
    const snapshot = makeSnapshot();
    const mutation: CreateMutation = {
      type: 'CREATE',
      className: 'Token',
      name: 'gold',
      parentId: 2,
      elementId: 20,
    };
    applyCreateMutation(snapshot, mutation);

    const discard = findElementById(snapshot, 2);
    expect(discard?.children?.length).toBe(1);
    expect(discard?.children?.[0]).toEqual({
      className: 'Token', id: 20, name: 'gold', attributes: {},
    });
  });

  test('creates element with attributes', () => {
    const snapshot = makeSnapshot();
    const mutation: CreateMutation = {
      type: 'CREATE',
      className: 'Token',
      name: 'shield',
      parentId: 1,
      elementId: 30,
      attributes: { defense: 3, enchanted: true },
    };
    applyCreateMutation(snapshot, mutation);

    const created = findElementById(snapshot, 30);
    expect(created?.attributes).toEqual({ defense: 3, enchanted: true });
  });

  test('initializes children array if parent had none', () => {
    const snapshot = makeSnapshot();
    // warrior has no children array
    const warrior = findElementById(snapshot, 10)!;
    expect(warrior.children).toBeUndefined();

    const mutation: CreateMutation = {
      type: 'CREATE',
      className: 'Buff',
      name: 'rage',
      parentId: 10,
      elementId: 40,
    };
    applyCreateMutation(snapshot, mutation);

    expect(warrior.children?.length).toBe(1);
    expect(warrior.children?.[0].name).toBe('rage');
  });
});

// ---------------------------------------------------------------------------
// applySetAttributeMutation
// ---------------------------------------------------------------------------

describe('applySetAttributeMutation', () => {
  test('updates existing attribute', () => {
    const snapshot = makeSnapshot();
    const mutation: SetAttributeMutation = {
      type: 'SET_ATTRIBUTE',
      elementId: 10,
      attribute: 'hp',
      oldValue: 5,
      newValue: 2,
    };
    applySetAttributeMutation(snapshot, mutation);

    const warrior = findElementById(snapshot, 10);
    expect(warrior?.attributes.hp).toBe(2);
  });

  test('sets new attribute that did not exist before', () => {
    const snapshot = makeSnapshot();
    const mutation: SetAttributeMutation = {
      type: 'SET_ATTRIBUTE',
      elementId: 10,
      attribute: 'poisoned',
      oldValue: undefined,
      newValue: true,
    };
    applySetAttributeMutation(snapshot, mutation);

    const warrior = findElementById(snapshot, 10);
    expect(warrior?.attributes.poisoned).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applySetPropertyMutation
// ---------------------------------------------------------------------------

describe('applySetPropertyMutation', () => {
  test('updates game property in snapshot.attributes', () => {
    const snapshot = makeSnapshot();
    const mutation: SetPropertyMutation = {
      type: 'SET_PROPERTY',
      property: 'score',
      oldValue: 0,
      newValue: 42,
    };
    applySetPropertyMutation(snapshot, mutation);
    expect(snapshot.attributes.score).toBe(42);
  });

  test('sets new game property', () => {
    const snapshot = makeSnapshot();
    const mutation: SetPropertyMutation = {
      type: 'SET_PROPERTY',
      property: 'winner',
      oldValue: undefined,
      newValue: 'player1',
    };
    applySetPropertyMutation(snapshot, mutation);
    expect(snapshot.attributes.winner).toBe('player1');
  });
});

// ---------------------------------------------------------------------------
// applyMutations (dispatcher + batch)
// ---------------------------------------------------------------------------

describe('applyMutations', () => {
  test('applies multiple mutations in order', () => {
    const snapshot = makeSnapshot();
    applyMutations(snapshot, [
      { type: 'SET_ATTRIBUTE', elementId: 10, attribute: 'hp', oldValue: 5, newValue: 3 },
      { type: 'SET_ATTRIBUTE', elementId: 10, attribute: 'hp', oldValue: 3, newValue: 1 },
    ]);
    const warrior = findElementById(snapshot, 10);
    expect(warrior?.attributes.hp).toBe(1);
  });

  test('handles mixed mutation types', () => {
    const snapshot = makeSnapshot();
    applyMutations(snapshot, [
      // Move warrior to discard
      { type: 'MOVE', elementId: 10, fromParentId: 1, toParentId: 2 },
      // Update mage hp
      { type: 'SET_ATTRIBUTE', elementId: 11, attribute: 'hp', oldValue: 3, newValue: 0 },
      // Update game score
      { type: 'SET_PROPERTY', property: 'score', oldValue: 0, newValue: 10 },
    ]);

    const board = findElementById(snapshot, 1);
    const discard = findElementById(snapshot, 2);
    expect(board?.children?.length).toBe(1);
    expect(discard?.children?.length).toBe(1);
    expect(discard?.children?.[0].name).toBe('warrior');
    expect(findElementById(snapshot, 11)?.attributes.hp).toBe(0);
    expect(snapshot.attributes.score).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  test('applyMoveMutation when source element not found is a no-op', () => {
    const snapshot = makeSnapshot();
    const before = JSON.stringify(snapshot);
    applyMoveMutation(snapshot, {
      type: 'MOVE', elementId: 999, fromParentId: 1, toParentId: 2,
    });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  test('applySetAttributeMutation when element not found is a no-op', () => {
    const snapshot = makeSnapshot();
    const before = JSON.stringify(snapshot);
    applySetAttributeMutation(snapshot, {
      type: 'SET_ATTRIBUTE', elementId: 999, attribute: 'hp', oldValue: 5, newValue: 0,
    });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  test('applyCreateMutation when parent not found is a no-op', () => {
    const snapshot = makeSnapshot();
    const before = JSON.stringify(snapshot);
    applyCreateMutation(snapshot, {
      type: 'CREATE', className: 'Token', name: 'x', parentId: 999, elementId: 50,
    });
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

// ===========================================================================
// Integration tests: Theatre state wired into Game class
// ===========================================================================

class TestPiece extends Piece {
  hp = 5;
}

class Board extends Space {}

class TestGame extends Game {
  score = 0;
  round = 1;
}

function createTestGame() {
  const game = new TestGame({ playerCount: 2, seed: 'theatre-test' });
  const reg = game._ctx.classRegistry as Map<string, any>;
  reg.set('TestPiece', TestPiece);
  reg.set('Board', Board);
  reg.set('TestGame', TestGame);
  reg.set('Space', Space);
  reg.set('Player', Player);
  const board = game.create(Board, 'board');
  const p1 = board.create(TestPiece, 'warrior', { hp: 5 });
  const p2 = board.create(TestPiece, 'mage', { hp: 5 });
  const discard = game.create(Space, 'discard');
  game.phase = 'started';
  return { game, board, p1, p2, discard };
}

// ---------------------------------------------------------------------------
// Theatre state lifecycle
// ---------------------------------------------------------------------------

describe('Theatre state lifecycle', () => {
  test('_theatreSnapshot is null before any animate() call', () => {
    const { game } = createTestGame();
    expect((game as any)._theatreSnapshot).toBeNull();
  });

  test('animate() creates theatre snapshot before callback runs', () => {
    const { game, p1 } = createTestGame();

    game.animate('death', { pieceId: p1._t.id }, () => {
      p1.remove();
    });

    // Theatre snapshot should exist after animate()
    expect((game as any)._theatreSnapshot).not.toBeNull();
  });

  test('theatre snapshot captures pre-mutation state', () => {
    const { game, board, p1 } = createTestGame();
    const p1Id = p1._t.id;
    const boardId = board._t.id;

    game.animate('death', { pieceId: p1Id }, () => {
      p1.remove();
    });

    const theatreSnapshot = (game as any)._theatreSnapshot;
    // The theatre snapshot should still have the piece (pre-mutation)
    const boardInSnapshot = findElementById(theatreSnapshot, boardId);
    const pieceInSnapshot = findElementById(theatreSnapshot, p1Id);
    expect(pieceInSnapshot).toBeDefined();
    expect(boardInSnapshot?.children?.some((c: ElementJSON) => c.id === p1Id)).toBe(true);
  });

  test('theatreState getter returns toJSON() when no animations pending', () => {
    const { game } = createTestGame();
    const theatreState = game.theatreState;
    const truth = game.toJSON();

    // Should be deeply equal (both are fresh toJSON snapshots)
    expect(theatreState.phase).toBe(truth.phase);
    expect(theatreState.attributes.score).toBe(truth.attributes.score);
    expect(theatreState.children?.length).toBe(truth.children?.length);
  });
});

// ---------------------------------------------------------------------------
// Per-event acknowledgment (ENG-05)
// ---------------------------------------------------------------------------

describe('Per-event acknowledgment (ENG-05)', () => {
  test('acknowledging event advances theatre state', () => {
    const { game, p1 } = createTestGame();
    const p1Id = p1._t.id;

    const event = game.animate('death', { pieceId: p1Id }, () => {
      p1.remove();
    });

    // Before ack: theatre state still has the piece
    const beforeAck = game.theatreState;
    expect(findElementById(beforeAck, p1Id)).toBeDefined();

    // After ack: theatre state should NOT have the piece (it was removed to pile which is not in snapshot)
    game.acknowledgeAnimationEvents(event.id);

    // All events acknowledged, so theatre snapshot is cleared and theatreState returns toJSON()
    // The piece was removed to pile, so truth doesn't have it on the board
    const afterAck = game.theatreState;
    const boardInAfter = afterAck.children?.find(c => c.name === 'board');
    expect(boardInAfter?.children?.some((c: ElementJSON) => c.id === p1Id)).toBe(false);
  });

  test('acknowledging one of two events advances theatre state by exactly one step', () => {
    const { game, p1, p2 } = createTestGame();
    const p1Id = p1._t.id;
    const p2Id = p2._t.id;

    // Event 1: remove piece1
    const event1 = game.animate('death', { pieceId: p1Id }, () => {
      p1.remove();
    });

    // Event 2: remove piece2
    const event2 = game.animate('death', { pieceId: p2Id }, () => {
      p2.remove();
    });

    // Acknowledge only event 1
    game.acknowledgeAnimationEvents(event1.id);

    // Theatre state should show piece1 gone but piece2 still present
    const theatreState = game.theatreState;
    const boardInTheatre = theatreState.children?.find((c: ElementJSON) => c.name === 'board');
    expect(boardInTheatre?.children?.some((c: ElementJSON) => c.id === p1Id)).toBe(false);
    expect(boardInTheatre?.children?.some((c: ElementJSON) => c.id === p2Id)).toBe(true);
  });

  test('acknowledging all events clears theatre snapshot', () => {
    const { game, p1 } = createTestGame();
    const p1Id = p1._t.id;

    const event = game.animate('death', { pieceId: p1Id }, () => {
      p1.remove();
    });

    game.acknowledgeAnimationEvents(event.id);
    expect((game as any)._theatreSnapshot).toBeNull();
  });

  test('acknowledging event with property mutation updates theatre state', () => {
    const { game } = createTestGame();

    const event = game.animate('score', { points: 42 }, () => {
      game.score = 42;
    });

    // Before ack: theatre state should have score = 0
    expect(game.theatreState.attributes.score).toBe(0);

    // After ack: theatre state should have score = 42
    game.acknowledgeAnimationEvents(event.id);
    expect(game.theatreState.attributes.score).toBe(42);
  });

  test('acknowledging event without mutations (emitAnimationEvent) is a no-op on theatre state', () => {
    const { game, p1 } = createTestGame();
    const p1Id = p1._t.id;

    // emitAnimationEvent creates event without mutations
    const emitEvent = game.emitAnimationEvent('flash', { color: 'red' });

    // Then animate with real mutations
    const animateEvent = game.animate('death', { pieceId: p1Id }, () => {
      p1.remove();
    });

    // Acknowledge the emitAnimationEvent -- should not change theatre state
    game.acknowledgeAnimationEvents(emitEvent.id);

    // Theatre state should still have the piece (emitAnimationEvent had no mutations)
    const theatreState = game.theatreState;
    expect(findElementById(theatreState, p1Id)).toBeDefined();

    // Now acknowledge the animate event
    game.acknowledgeAnimationEvents(animateEvent.id);

    // All events acknowledged, snapshot cleared, theatreState = toJSON()
    expect((game as any)._theatreSnapshot).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multiple animate calls (roadmap success criteria #4)
// ---------------------------------------------------------------------------

describe('Multiple animate calls', () => {
  test('multiple animate calls reuse the same snapshot baseline', () => {
    const { game, p1, p2 } = createTestGame();
    const p1Id = p1._t.id;
    const p2Id = p2._t.id;

    // First animate
    game.animate('hit', { pieceId: p1Id }, () => {
      p1.hp = 3;
    });

    const snapshotAfterFirst = (game as any)._theatreSnapshot;
    // The snapshot should have the original hp=5 for p1 (pre-first-animate)
    const p1InSnapshot = findElementById(snapshotAfterFirst, p1Id);
    expect(p1InSnapshot?.attributes.hp).toBe(5);

    // Second animate
    game.animate('hit', { pieceId: p2Id }, () => {
      p2.hp = 1;
    });

    // The snapshot should NOT have been re-initialized (still same baseline)
    const snapshotAfterSecond = (game as any)._theatreSnapshot;
    expect(snapshotAfterSecond).toBe(snapshotAfterFirst); // Same object reference
  });

  test('stepping through events one by one reaches truth', () => {
    const { game, p1, p2 } = createTestGame();

    // Three animate calls with different mutations
    const event1 = game.animate('scoreUp', {}, () => {
      game.score = 10;
    });
    const event2 = game.animate('hit', {}, () => {
      p1.hp = 3;
    });
    const event3 = game.animate('hit', {}, () => {
      p2.hp = 1;
    });

    // Step 1: acknowledge first event
    game.acknowledgeAnimationEvents(event1.id);
    expect(game.theatreState.attributes.score).toBe(10);
    const p1After1 = findElementById(game.theatreState, p1._t.id);
    expect(p1After1?.attributes.hp).toBe(5); // Not yet acknowledged

    // Step 2: acknowledge second event
    game.acknowledgeAnimationEvents(event2.id);
    const p1After2 = findElementById(game.theatreState, p1._t.id);
    expect(p1After2?.attributes.hp).toBe(3);
    const p2After2 = findElementById(game.theatreState, p2._t.id);
    expect(p2After2?.attributes.hp).toBe(5); // Not yet acknowledged

    // Step 3: acknowledge third event -- all done, snapshot cleared
    game.acknowledgeAnimationEvents(event3.id);
    expect((game as any)._theatreSnapshot).toBeNull();
    // theatreState now returns toJSON() which is the truth
    expect(game.theatreState.attributes.score).toBe(10);
    const p1Final = findElementById(game.theatreState, p1._t.id);
    const p2Final = findElementById(game.theatreState, p2._t.id);
    expect(p1Final?.attributes.hp).toBe(3);
    expect(p2Final?.attributes.hp).toBe(1);
  });

  test('theatre snapshot not re-initialized between animate calls', () => {
    const { game } = createTestGame();

    game.animate('a', {}, () => {
      game.score = 5;
    });

    const snapshotRef = (game as any)._theatreSnapshot;
    expect(snapshotRef).not.toBeNull();

    game.animate('b', {}, () => {
      game.score = 10;
    });

    // Same object reference (not re-initialized)
    expect((game as any)._theatreSnapshot).toBe(snapshotRef);
    // Still shows pre-first-animate score
    expect(snapshotRef.attributes.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Serialization round-trip (ENG-06)
// ---------------------------------------------------------------------------

describe('Serialization round-trip (ENG-06)', () => {
  test('toJSON includes theatreSnapshot when pending events exist', () => {
    const { game, p1 } = createTestGame();

    game.animate('death', { pieceId: p1._t.id }, () => {
      p1.remove();
    });

    const json = game.toJSON();
    expect(json.theatreSnapshot).toBeDefined();
    expect(json.theatreSnapshot).not.toBeNull();
  });

  test('toJSON omits theatreSnapshot when no pending events', () => {
    const { game } = createTestGame();

    const json = game.toJSON();
    expect(json.theatreSnapshot).toBeUndefined();
  });

  test('restoreGame preserves theatre snapshot and pending events', () => {
    const { game, p1, p2 } = createTestGame();
    const p1Id = p1._t.id;
    const p2Id = p2._t.id;

    // Create two animate events
    const event1 = game.animate('hit', {}, () => {
      p1.hp = 2;
    });
    game.animate('hit', {}, () => {
      p2.hp = 1;
    });

    // Acknowledge first event to advance theatre state
    game.acknowledgeAnimationEvents(event1.id);

    // Serialize
    const json = game.toJSON();
    expect(json.theatreSnapshot).toBeDefined();

    // Restore
    const classRegistry = new Map<string, any>();
    classRegistry.set('TestPiece', TestPiece);
    classRegistry.set('Board', Board);
    classRegistry.set('TestGame', TestGame);
    classRegistry.set('Space', Space);
    classRegistry.set('Player', Player);
    const restored = Game.restoreGame(json, TestGame, classRegistry);

    // Restored game should have same theatre state
    expect((restored as any)._theatreSnapshot).toBeDefined();
    expect((restored as any)._theatreSnapshot).not.toBeNull();

    // Restored game should have one pending event (event2)
    expect(restored.pendingAnimationEvents).toHaveLength(1);

    // Acknowledging the remaining event on the restored game should work
    const pending = restored.pendingAnimationEvents;
    restored.acknowledgeAnimationEvents(pending[0].id);
    expect((restored as any)._theatreSnapshot).toBeNull();

    // Theatre state matches truth after all acknowledged
    const restoredP2 = findElementById(restored.theatreState, p2Id);
    expect(restoredP2?.attributes.hp).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Theatre state edge cases', () => {
  test('theatreState getter returns toJSON when all events acknowledged', () => {
    const { game, p1 } = createTestGame();

    const event = game.animate('hit', {}, () => {
      p1.hp = 2;
    });

    game.acknowledgeAnimationEvents(event.id);

    // theatreState should now match toJSON()
    const theatreState = game.theatreState;
    const truth = game.toJSON();
    expect(theatreState.attributes.score).toBe(truth.attributes.score);
    expect(theatreState.phase).toBe(truth.phase);
    const p1InTheatre = findElementById(theatreState, p1._t.id);
    const p1InTruth = findElementById(truth, p1._t.id);
    expect(p1InTheatre?.attributes.hp).toBe(p1InTruth?.attributes.hp);
  });

  test('animate after full acknowledgment creates new snapshot', () => {
    const { game, p1 } = createTestGame();

    // First animate + acknowledge all
    const event1 = game.animate('hit', {}, () => {
      p1.hp = 3;
    });
    game.acknowledgeAnimationEvents(event1.id);
    expect((game as any)._theatreSnapshot).toBeNull();

    // Second animate -- should create new snapshot from current truth
    const event2 = game.animate('hit', {}, () => {
      p1.hp = 1;
    });
    expect((game as any)._theatreSnapshot).not.toBeNull();

    // New snapshot should reflect current truth (hp=3 from after first round)
    const newSnapshot = (game as any)._theatreSnapshot;
    const p1InNewSnapshot = findElementById(newSnapshot, p1._t.id);
    expect(p1InNewSnapshot?.attributes.hp).toBe(3);

    // Acknowledge second event
    game.acknowledgeAnimationEvents(event2.id);
    expect((game as any)._theatreSnapshot).toBeNull();
    // Truth: hp=1
    const p1Final = findElementById(game.theatreState, p1._t.id);
    expect(p1Final?.attributes.hp).toBe(1);
  });
});

// ===========================================================================
// theatreStateForPlayer() tests
// ===========================================================================

class VisibilityPiece extends Piece {
  value = 0;
  $type = 'card';
}

class VisibilityGame extends Game {
  score = 0;

  static override playerView = (state: ElementJSON, playerSeat: number | null, _game: Game): ElementJSON => {
    // Add a marker attribute so tests can verify playerView was applied
    return {
      ...state,
      attributes: {
        ...state.attributes,
        __playerViewApplied: true,
        __viewSeat: playerSeat,
      },
    };
  };
}

function createVisibilityGame() {
  const game = new VisibilityGame({ playerCount: 2, seed: 'visibility-test' });
  const reg = game._ctx.classRegistry as Map<string, any>;
  reg.set('VisibilityPiece', VisibilityPiece);
  reg.set('VisibilityGame', VisibilityGame);
  reg.set('Space', Space);
  reg.set('Player', Player);

  const board = game.create(Space, 'board');
  const hand1 = game.create(Space, 'hand1', { player: game.getPlayer(1) });
  hand1.contentsVisibleToOwner();
  const hand2 = game.create(Space, 'hand2', { player: game.getPlayer(2) });
  hand2.contentsVisibleToOwner();
  const countOnly = game.create(Space, 'countOnly');
  countOnly.contentsCountOnly();
  const hiddenZone = game.create(Space, 'hiddenZone');
  hiddenZone.contentsHidden();

  const boardPiece = board.create(VisibilityPiece, 'bp', { value: 10 });
  const h1piece = hand1.create(VisibilityPiece, 'h1p', { value: 20 });
  const h2piece = hand2.create(VisibilityPiece, 'h2p', { value: 30 });
  const countPiece1 = countOnly.create(VisibilityPiece, 'cp1', { value: 40 });
  const countPiece2 = countOnly.create(VisibilityPiece, 'cp2', { value: 50 });
  const hiddenPiece = hiddenZone.create(VisibilityPiece, 'hp', { value: 60 });

  game.phase = 'started';

  return { game, board, hand1, hand2, countOnly, hiddenZone, boardPiece, h1piece, h2piece, countPiece1, countPiece2, hiddenPiece };
}

// Use a separate game class without playerView for non-playerView tests
class PlainVisibilityGame extends Game {
  score = 0;
}

function createPlainVisibilityGame() {
  const game = new PlainVisibilityGame({ playerCount: 2, seed: 'plain-vis-test' });
  const reg = game._ctx.classRegistry as Map<string, any>;
  reg.set('VisibilityPiece', VisibilityPiece);
  reg.set('PlainVisibilityGame', PlainVisibilityGame);
  reg.set('Space', Space);
  reg.set('Player', Player);

  const board = game.create(Space, 'board');
  const hand1 = game.create(Space, 'hand1', { player: game.getPlayer(1) });
  hand1.contentsVisibleToOwner();
  const hand2 = game.create(Space, 'hand2', { player: game.getPlayer(2) });
  hand2.contentsVisibleToOwner();
  const countOnly = game.create(Space, 'countOnly');
  countOnly.contentsCountOnly();
  const hiddenZone = game.create(Space, 'hiddenZone');
  hiddenZone.contentsHidden();

  const boardPiece = board.create(VisibilityPiece, 'bp', { value: 10 });
  const h1piece = hand1.create(VisibilityPiece, 'h1p', { value: 20 });
  const h2piece = hand2.create(VisibilityPiece, 'h2p', { value: 30 });
  const countPiece1 = countOnly.create(VisibilityPiece, 'cp1', { value: 40 });
  const countPiece2 = countOnly.create(VisibilityPiece, 'cp2', { value: 50 });
  const hiddenPiece = hiddenZone.create(VisibilityPiece, 'hp', { value: 60 });

  game.phase = 'started';

  return { game, board, hand1, hand2, countOnly, hiddenZone, boardPiece, h1piece, h2piece, countPiece1, countPiece2, hiddenPiece };
}

describe('theatreStateForPlayer()', () => {
  test('falls through to toJSONForPlayer when no theatre snapshot', () => {
    const { game } = createPlainVisibilityGame();

    // No animate() call, so _theatreSnapshot is null
    const theatreResult = game.theatreStateForPlayer(1);
    const directResult = game.toJSONForPlayer(1);

    // Should be deeply equal
    expect(theatreResult).toEqual(directResult);
  });

  test('returns theatre snapshot with visibility filtering when animations pending', () => {
    const { game, board, boardPiece } = createPlainVisibilityGame();
    const pieceId = boardPiece._t.id;
    const discard = game.create(Space, 'discard');

    // Move piece from board to discard inside animate()
    game.animate('move', { pieceId }, () => {
      boardPiece.putInto(discard);
    });

    // In truth, piece is in discard. In theatre, piece should still be on board.
    const theatreView = game.theatreStateForPlayer(1);
    const boardInTheatre = theatreView.children?.find(c => c.name === 'board');
    expect(boardInTheatre?.children?.some(c => c.id === pieceId)).toBe(true);

    // Verify it's NOT in discard in the theatre view
    const discardInTheatre = theatreView.children?.find(c => c.name === 'discard');
    expect(discardInTheatre?.children?.some(c => c.id === pieceId)).toBeFalsy();
  });

  test('hides elements from non-owners in theatre view', () => {
    const { game, hand1, h1piece } = createPlainVisibilityGame();
    const h1pieceId = h1piece._t.id;

    // Trigger animate to create theatre snapshot
    game.animate('flash', {}, () => {
      game.score = 1;
    });

    // Player 1 owns hand1 -- should see h1piece
    const p1View = game.theatreStateForPlayer(1);
    const hand1InP1 = p1View.children?.find(c => c.name === 'hand1');
    const h1pInP1 = hand1InP1?.children?.find(c => c.id === h1pieceId);
    expect(h1pInP1).toBeDefined();
    expect(h1pInP1?.attributes.__hidden).toBeUndefined();

    // Player 2 does NOT own hand1 -- should see hidden placeholder
    const p2View = game.theatreStateForPlayer(2);
    const hand1InP2 = p2View.children?.find(c => c.name === 'hand1');
    const h1pInP2 = hand1InP2?.children?.find(c => c.id === h1pieceId);
    expect(h1pInP2).toBeDefined();
    expect(h1pInP2?.attributes.__hidden).toBe(true);
  });

  test('count-only zones show childCount in theatre view', () => {
    const { game, countOnly, countPiece1, countPiece2 } = createPlainVisibilityGame();

    // Trigger animate to create theatre snapshot
    game.animate('flash', {}, () => {
      game.score = 1;
    });

    const view = game.theatreStateForPlayer(1);
    const countOnlyInView = view.children?.find(c => c.name === 'countOnly');

    // count-only zone should show childCount matching theatre's children count
    expect(countOnlyInView?.childCount).toBe(2);

    // Children should be anonymized (hidden placeholders with negative IDs)
    expect(countOnlyInView?.children).toBeDefined();
    for (const child of countOnlyInView?.children ?? []) {
      expect(child.attributes.__hidden).toBe(true);
      expect(child.id).toBeLessThan(0); // Negative ID to prevent correlation
    }
  });

  test('applies static playerView transformation', () => {
    const { game } = createVisibilityGame();

    // Trigger animate to create theatre snapshot
    game.animate('flash', {}, () => {
      game.score = 1;
    });

    const view = game.theatreStateForPlayer(1);
    expect(view.attributes.__playerViewApplied).toBe(true);
    expect(view.attributes.__viewSeat).toBe(1);

    const view2 = game.theatreStateForPlayer(2);
    expect(view2.attributes.__playerViewApplied).toBe(true);
    expect(view2.attributes.__viewSeat).toBe(2);
  });

  test('does not mutate shared theatre snapshot', () => {
    const { game } = createPlainVisibilityGame();

    // Trigger animate to create theatre snapshot
    game.animate('flash', {}, () => {
      game.score = 1;
    });

    // Capture the raw snapshot
    const snapshotBefore = JSON.stringify((game as any)._theatreSnapshot);

    // Call theatreStateForPlayer multiple times
    game.theatreStateForPlayer(1);
    game.theatreStateForPlayer(2);
    game.theatreStateForPlayer(null); // spectator

    // The raw snapshot should not be modified
    const snapshotAfter = JSON.stringify((game as any)._theatreSnapshot);
    expect(snapshotAfter).toBe(snapshotBefore);
  });

  test('handles elements in pile (removed in truth, present in theatre)', () => {
    const { game, board, boardPiece } = createPlainVisibilityGame();
    const pieceId = boardPiece._t.id;

    // Remove piece inside animate() -- piece goes to pile in truth
    game.animate('death', { pieceId }, () => {
      boardPiece.remove();
    });

    // In truth, piece is in pile. In theatre, piece is still on board.
    // theatreStateForPlayer should show the piece in its theatre position
    // because board is visible to everyone.
    const view = game.theatreStateForPlayer(1);
    const boardInView = view.children?.find(c => c.name === 'board');
    expect(boardInView?.children?.some(c => c.id === pieceId)).toBe(true);

    // Verify the piece is actually in the pile in truth
    expect(game.pile.atId(pieceId)).toBeDefined();
  });

  test('hidden zone children are anonymized in theatre view', () => {
    const { game, hiddenZone, hiddenPiece } = createPlainVisibilityGame();

    // Trigger animate to create theatre snapshot
    game.animate('flash', {}, () => {
      game.score = 1;
    });

    const view = game.theatreStateForPlayer(1);
    const hiddenZoneInView = view.children?.find(c => c.name === 'hiddenZone');

    // Hidden zone children should be anonymized placeholders
    expect(hiddenZoneInView?.children).toBeDefined();
    expect(hiddenZoneInView?.childCount).toBe(1);
    for (const child of hiddenZoneInView?.children ?? []) {
      expect(child.attributes.__hidden).toBe(true);
      expect(child.id).toBeLessThan(0); // Negative ID
    }
  });

  test('spectator view hides owner-only content in theatre view', () => {
    const { game, hand1, h1piece } = createPlainVisibilityGame();
    const h1pieceId = h1piece._t.id;

    // Trigger animate to create theatre snapshot
    game.animate('flash', {}, () => {
      game.score = 1;
    });

    // Spectator (null) should see hidden placeholders for owner-only zones
    const spectatorView = game.theatreStateForPlayer(null);
    const hand1InSpectator = spectatorView.children?.find(c => c.name === 'hand1');
    const h1pInSpectator = hand1InSpectator?.children?.find(c => c.id === h1pieceId);
    expect(h1pInSpectator).toBeDefined();
    expect(h1pInSpectator?.attributes.__hidden).toBe(true);
  });

  test('visible elements on board show full attributes in theatre view', () => {
    const { game, boardPiece } = createPlainVisibilityGame();
    const pieceId = boardPiece._t.id;

    // Trigger animate to create theatre snapshot
    game.animate('flash', {}, () => {
      game.score = 1;
    });

    const view = game.theatreStateForPlayer(1);
    const boardInView = view.children?.find(c => c.name === 'board');
    const pieceInView = boardInView?.children?.find(c => c.id === pieceId);

    // Visible piece should have its full attributes
    expect(pieceInView).toBeDefined();
    expect(pieceInView?.attributes.value).toBe(10);
    expect(pieceInView?.attributes.__hidden).toBeUndefined();
  });
});
