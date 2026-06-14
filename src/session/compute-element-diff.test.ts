import { describe, it, expect } from 'vitest';
import { computeElementDiff } from './utils.js';

/**
 * Regression test for F6: the element-diff algorithm used by GameSession's
 * state-history diff (state-history.ts) and the stateless executor's debug
 * state diff (stateless-ops.ts) must be ONE shared implementation, so the two
 * call sites can never drift.
 *
 * This test pins the behavior of the shared computeElementDiff helper. Before
 * the fix this function did not exist (the algorithm was copy-pasted into both
 * modules), so this test cannot even compile against the pre-fix code.
 */
describe('computeElementDiff (shared element-diff helper)', () => {
  it('reports an added element when an id appears only in the new view', () => {
    const from = { id: 1, children: [{ id: 2 }] };
    const to = { id: 1, children: [{ id: 2 }, { id: 3 }] };
    expect(computeElementDiff(from, to)).toEqual({ added: [3], removed: [], changed: [] });
  });

  it('reports a removed element when an id appears only in the old view', () => {
    const from = { id: 1, children: [{ id: 2 }, { id: 3 }] };
    const to = { id: 1, children: [{ id: 2 }] };
    expect(computeElementDiff(from, to)).toEqual({ added: [], removed: [3], changed: [] });
  });

  it('reports a changed element when it moves to a different parent', () => {
    const from = { id: 1, children: [{ id: 10, children: [{ id: 99 }] }, { id: 20 }] };
    const to = { id: 1, children: [{ id: 10 }, { id: 20, children: [{ id: 99 }] }] };
    expect(computeElementDiff(from, to)).toEqual({ added: [], removed: [], changed: [99] });
  });

  it('reports a changed element when its game-state attributes change', () => {
    const from = { id: 1, children: [{ id: 7, attributes: { rank: 'A' } }] };
    const to = { id: 1, children: [{ id: 7, attributes: { rank: 'K' } }] };
    expect(computeElementDiff(from, to)).toEqual({ added: [], removed: [], changed: [7] });
  });

  it('ignores player objects and internal metadata when comparing attributes', () => {
    const from = {
      id: 1,
      children: [{ id: 7, attributes: { rank: 'A', player: { position: 1 }, _internal: 'x' } }],
    };
    const to = {
      id: 1,
      children: [{ id: 7, attributes: { rank: 'A', player: { position: 2 }, _internal: 'y' } }],
    };
    // Only player/_-prefixed metadata changed -> not a real game-state change.
    expect(computeElementDiff(from, to)).toEqual({ added: [], removed: [], changed: [] });
  });

  it('treats id-less nodes as transparent, preserving parent ids through them', () => {
    // Wrapper node without an id; child 99 should be parented to id 1.
    const from = { id: 1, children: [{ children: [{ id: 99 }] }] };
    const to = { id: 1, children: [{ id: 99 }] };
    // Same parent (1) in both -> no change reported.
    expect(computeElementDiff(from, to)).toEqual({ added: [], removed: [], changed: [] });
  });
});
