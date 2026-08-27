// @vitest-environment jsdom
/**
 * The leak assertion has to actually run, and actually check something (#20).
 *
 * Two independent defects with one consequence: a game believes it has
 * DOM-level leak coverage when it has none.
 *
 * 1. The inert controller was hand-listed, so it drifted behind the real
 *    `useActionController` return. A board reading `showActionPanel` or
 *    `lastActionResult` — both published by the real composable, both the
 *    documented way to know whether controls may be offered and what the last
 *    action resolved to — threw during setup(), before a single node rendered.
 *    The assertion never reached its own logic, and the failure was a bare
 *    TypeError pointing into the game's component.
 * 2. `stringifyScalar` returned undefined for anything but a string or number,
 *    so a game packing private state into arrays contributed ZERO forbidden
 *    markers for those fields, and the assertion passed over an almost-empty
 *    marker set.
 */
import { describe, it, expect } from 'vitest';
import { _inertActionControllerForTests, _identityCandidatesForTests } from './dom-leak.js';

describe('the inert controller is controller-shaped (#20)', () => {
  const inert = _inertActionControllerForTests(['move']);

  it.each([
    'availableActions',
    'currentAction',
    'currentChoices',
    'isExecuting',
    'selectableElementIds',
  ])('carries %s, as it always did', (field) => {
    expect(inert[field]).toBeDefined();
  });

  it.each(['showActionPanel', 'lastActionResult'])(
    'carries %s, which a real board reads and the hand-list omitted',
    (field) => {
      expect(inert[field]).toBeDefined();
    },
  );

  it('gives every ref-shaped field a readable .value rather than undefined', () => {
    for (const [name, value] of Object.entries(inert)) {
      if (typeof value === 'function') continue;
      expect(value, name).toHaveProperty('value');
    }
  });

  it('is inert — nothing it exposes can submit an action', () => {
    // Every non-ref member is a no-op function; none returns a promise that
    // could carry a submission.
    for (const [name, value] of Object.entries(inert)) {
      if (typeof value !== 'function') continue;
      expect(() => (value as () => unknown)(), name).not.toThrow();
    }
  });
});

describe('array-valued attributes produce markers (#20)', () => {
  const candidates = (attributes: Record<string, unknown>) =>
    _identityCandidatesForTests({ className: 'Sector', id: 1, attributes });

  it('still extracts strings and numbers', () => {
    const values = candidates({ species: 'wolf', strength: 12 }).map((c) => c.value);
    expect(values).toContain('wolf');
    expect(values).toContain('12');
  });

  it('extracts each element of an array of scalars', () => {
    // The shape the report describes: private state packed positionally.
    const values = candidates({ stats: [1234, 'wolf'] }).map((c) => c.value);
    expect(values).toContain('1234');
    expect(values).toContain('wolf');
  });

  it('attributes each marker to the field it came from', () => {
    const found = candidates({ stats: [1234, 'wolf'] });
    expect(found.every((c) => c.attribute === 'stats')).toBe(true);
  });

  it('drops a short number reached by recursion — it is not evidence', () => {
    // A positional stat block is full of small integers, and a "3" on the page
    // says a 3 is on screen, not that THIS 3 is. That collision class is why
    // the utility scopes its DOM scan in the first place.
    const values = candidates({ stats: [7, 3, 'wolf'] }).map((c) => c.value);
    expect(values).not.toContain('7');
    expect(values).not.toContain('3');
    expect(values).toContain('wolf');
  });

  it('keeps a short number that is an attribute\'s WHOLE value, as it always did', () => {
    // The attribute name scopes it, and this was the contract before arrays
    // were walked at all.
    expect(candidates({ rank: 3 }).map((c) => c.value)).toContain('3');
  });

  it('reaches inside a nested object, which is the other way state gets packed', () => {
    const values = candidates({ body: { species: 'hare', wounds: 2049 } }).map((c) => c.value);
    expect(values).toContain('hare');
    expect(values).toContain('2049');
  });

  it('reaches inside an array of objects', () => {
    const values = candidates({ pack: [{ name: 'wolf' }, { name: 'hare' }] }).map((c) => c.value);
    expect(values).toContain('wolf');
    expect(values).toContain('hare');
  });

  it('still ignores booleans, which would false-positive on almost any page', () => {
    const values = candidates({ faceUp: true, revealed: [true, false] }).map((c) => c.value);
    expect(values).not.toContain('true');
    expect(values).not.toContain('false');
  });

  it('skips a serialized element reference — an id is a public handle, not identity', () => {
    // Recursing into these is what turns "the page renders element 1" into a
    // reported leak. If element 1's identity is secret, that is element 1's own
    // attributes to protect, and they are walked in their own right.
    const found = candidates({ occupant: { __elementId: 1 } });
    expect(found.map((c) => c.value)).not.toContain('1');
  });

  it('skips a player reference — a seat number is on screen by design', () => {
    const found = candidates({ player: { seat: 1, name: 'A' } });
    expect(found.map((c) => c.value)).not.toContain('1');
    expect(found.map((c) => c.value)).not.toContain('A');
  });

  it('still skips $-prefixed layout metadata', () => {
    const found = candidates({ $gap: 4, $direction: 'row' });
    expect(found).toEqual([]);
  });

  it('does not recurse forever on a self-referencing attribute', () => {
    const loop: Record<string, unknown> = { name: 'wolf' };
    loop.self = loop;
    expect(() => candidates({ loop })).not.toThrow();
    expect(candidates({ loop }).map((c) => c.value)).toContain('wolf');
  });
});

describe('the inert controller cannot drift behind the real one', () => {
  it('carries every member a board is likely to read', async () => {
    // The real return type is an interface, so it has no runtime key list to
    // diff against. This pins the members the report named plus the rest of the
    // reactive surface — the set that, when one went missing, turned the leak
    // assertion into a TypeError inside the game's component.
    const inert = _inertActionControllerForTests([]);
    const expected = [
      'availableActions', 'currentAction', 'currentSelection', 'currentPick',
      'currentChoices', 'currentArgs', 'selectedArgs', 'pendingArgs',
      'isSelecting', 'isExecuting', 'isLoadingChoices', 'error',
      'selectableElementIds', 'validElements', 'repeatingState',
      'pendingFollowUp', 'pendingOnServer', 'actionCompletedTick',
      'multiSelectDraft', 'actionSnapshot', 'lastActionResult',
      'allCurrentChoicesAnchored', 'animationsPending', 'showActionPanel',
      'snapshotVersion',
      'start', 'fill', 'skip', 'clear', 'cancel', 'execute', 'undo',
      'toggleMultiSelect', 'confirmMultiSelect', 'isMultiSelectSelected',
      'getChoices', 'getCurrentChoices', 'getValidElements',
      'getActionMetadata', 'clearArgs', 'fetchChoicesForPick',
      'getCollectedPick', 'getCollectedPicks', 'setBeforeAutoExecute',
    ];
    for (const member of expected) {
      expect(inert[member], member).toBeDefined();
    }
  });

  it('returns a collection from the members whose real form returns one', () => {
    const inert = _inertActionControllerForTests([]) as Record<string, () => unknown>;
    expect(inert.getChoices()).toEqual([]);
    expect(inert.getCurrentChoices()).toEqual([]);
    expect(inert.getValidElements()).toEqual([]);
    expect(inert.getCollectedPicks()).toEqual([]);
  });

  it('returns an unregister function from setBeforeAutoExecute, as the real one does', () => {
    const inert = _inertActionControllerForTests([]) as Record<string, () => unknown>;
    expect(inert.setBeforeAutoExecute()).toBeTypeOf('function');
  });

  it('never claims the panel may be shown — an inert controller cannot submit', () => {
    const inert = _inertActionControllerForTests([]) as Record<string, { value: unknown }>;
    expect(inert.showActionPanel.value).toBe(false);
  });
});
