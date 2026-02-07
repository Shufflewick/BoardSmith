import { describe, test, expect } from 'vitest';
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
