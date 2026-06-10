import { describe, it, expect } from 'vitest';
import { assertCloneable } from './platformRequestClone.js';

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
