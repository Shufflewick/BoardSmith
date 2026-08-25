import { describe, it, expect } from 'vitest';
import { ref, reactive } from 'vue';
import { assertCloneable, toCloneablePayload } from './platformRequestClone.js';

describe('assertCloneable', () => {
  it('does not throw for a plain cloneable payload', () => {
    expect(() =>
      assertCloneable('action', { combatantId: 64, sectorId: 140 })
    ).not.toThrow();
  });

  it('throws with op name and "structured-cloneable" for a non-cloneable payload', () => {
    expect(() =>
      assertCloneable('collectEquipment', { fn: () => {} })
    ).toThrow(/collectEquipment/);

    expect(() =>
      assertCloneable('collectEquipment', { fn: () => {} })
    ).toThrow(/structured-cloneable/);
  });
});

/** A flow state a shell might have rendered: round 2 of a looping step. */
const RENDERED = { complete: false, position: { path: [1, 2, 2, 0] } };
const RENDERED_KEY = 'flow:p=1.2.2.0';

describe('toCloneablePayload', () => {
  it('normalizes a reactive ref array (the natural game-author arg) into a plain cloneable value', () => {
    const selectedCards = ref<number[]>([36, 18]);
    // A bare reactive proxy is NOT structured-cloneable — this is the cribbage discard bug.
    expect(() => structuredClone(selectedCards.value)).toThrow();

    const out = toCloneablePayload('action', { actionName: 'discard', args: { cards: selectedCards.value } }, RENDERED);
    // Result is plain + cloneable, and the values are preserved.
    expect(() => structuredClone(out)).not.toThrow();
    expect(out).toEqual({ actionName: 'discard', args: { cards: [36, 18] }, boundaryKey: RENDERED_KEY });
  });

  it('normalizes nested reactive objects', () => {
    const state = reactive({ args: { cards: [1, 2], meta: { ok: true } } });
    const out = toCloneablePayload('action', state, RENDERED);
    expect(() => structuredClone(out)).not.toThrow();
    expect(out).toEqual({ args: { cards: [1, 2], meta: { ok: true } }, boundaryKey: RENDERED_KEY });
  });

  it('still fails loud when a genuine non-cloneable value leaks (e.g. a live element carrying methods as own props)', () => {
    // A live game element typically carries non-cloneable own properties (callbacks,
    // bound methods). structuredClone rejects those, so the guard still fires.
    const leakedElement = { id: 5, putInto: () => {}, parent: null as unknown };
    expect(() =>
      toCloneablePayload('action', { args: { card: leakedElement } }, RENDERED)
    ).toThrow(/structured-cloneable/);

    expect(() =>
      toCloneablePayload('action', { args: { fn: () => {} } }, RENDERED)
    ).toThrow(/structured-cloneable/);
  });
});

describe('toCloneablePayload — the boundary stamp (BSMITH-05)', () => {
  it('stamps the boundary of the flow state the shell rendered, on every op', () => {
    // Not just submissions: a debug op carries it too, so "remember to add it
    // when you add a submission op" never becomes the guardrail.
    for (const op of ['action', 'selection_step', 'debug:flow-state', 'undo']) {
      expect(toCloneablePayload(op, {}, RENDERED).boundaryKey).toBe(RENDERED_KEY);
    }
  });

  it('names the boundary the shell RENDERED, not some other one', () => {
    const otherRound = { complete: false, position: { path: [1, 3, 2, 0] } };
    expect(toCloneablePayload('action', {}, otherRound).boundaryKey).not.toBe(RENDERED_KEY);
  });

  it('a shell that has rendered nothing stamps the no-flow-state key — fail-closed, never the current round', () => {
    // There is no way to ask for "whatever the server thinks is current": the
    // only input is what THIS shell rendered.
    expect(toCloneablePayload('action', {}, null).boundaryKey).toBe('flow:unknown');
    expect(toCloneablePayload('action', {}, undefined).boundaryKey).toBe('flow:unknown');
  });

  it('a caller-supplied boundaryKey does not survive — the shell stamps what it rendered', () => {
    const forged = toCloneablePayload('action', { boundaryKey: 'flow:p=9.9.9' }, RENDERED);
    expect(forged.boundaryKey).toBe(RENDERED_KEY);
  });

  it('the stamp is still structured-cloneable (it crosses postMessage)', () => {
    expect(() => structuredClone(toCloneablePayload('action', { args: {} }, RENDERED))).not.toThrow();
  });
});
