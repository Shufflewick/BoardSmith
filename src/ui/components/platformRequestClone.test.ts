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

describe('toCloneablePayload', () => {
  it('normalizes a reactive ref array (the natural game-author arg) into a plain cloneable value', () => {
    const selectedCards = ref<number[]>([36, 18]);
    // A bare reactive proxy is NOT structured-cloneable — this is the cribbage discard bug.
    expect(() => structuredClone(selectedCards.value)).toThrow();

    const out = toCloneablePayload('action', { actionName: 'discard', args: { cards: selectedCards.value } });
    // Result is plain + cloneable, and the values are preserved.
    expect(() => structuredClone(out)).not.toThrow();
    expect(out).toEqual({ actionName: 'discard', args: { cards: [36, 18] } });
  });

  it('normalizes nested reactive objects', () => {
    const state = reactive({ args: { cards: [1, 2], meta: { ok: true } } });
    const out = toCloneablePayload('action', state);
    expect(() => structuredClone(out)).not.toThrow();
    expect(out).toEqual({ args: { cards: [1, 2], meta: { ok: true } } });
  });

  it('still fails loud when a genuine non-cloneable value leaks (e.g. a live element carrying methods as own props)', () => {
    // A live game element typically carries non-cloneable own properties (callbacks,
    // bound methods). structuredClone rejects those, so the guard still fires.
    const leakedElement = { id: 5, putInto: () => {}, parent: null as unknown };
    expect(() =>
      toCloneablePayload('action', { args: { card: leakedElement } })
    ).toThrow(/structured-cloneable/);

    expect(() =>
      toCloneablePayload('action', { args: { fn: () => {} } })
    ).toThrow(/structured-cloneable/);
  });
});
