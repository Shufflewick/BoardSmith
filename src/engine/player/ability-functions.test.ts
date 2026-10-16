import { describe, it, expect } from 'vitest';
import { addAbility, hasUnusedAbility, spendAbility, countUnusedAbilities, groupAbilities } from './abilities.js';
import type { Ability } from './abilities.js';

type Power = 'reroll' | 'peek';

describe('ability functions (#779)', () => {
  it('addAbility appends an unused ability, keeping its provenance only when given', () => {
    const abilities: Ability<Power>[] = [];
    addAbility(abilities, 'reroll');
    addAbility(abilities, 'peek', 'starting');
    expect(abilities).toStrictEqual([
      { type: 'reroll', used: false },
      { type: 'peek', used: false, earnedFrom: 'starting' },
    ]);
  });

  it('spendAbility marks one unused ability of the type used, and says whether it could', () => {
    const abilities: Ability<Power>[] = [];
    addAbility(abilities, 'reroll');
    addAbility(abilities, 'reroll');
    expect(spendAbility(abilities, 'reroll')).toBe(true);
    expect(abilities.map((a) => a.used)).toEqual([true, false]);
    expect(hasUnusedAbility(abilities, 'reroll')).toBe(true);
    expect(spendAbility(abilities, 'reroll')).toBe(true);
    expect(hasUnusedAbility(abilities, 'reroll')).toBe(false);
    expect(spendAbility(abilities, 'reroll')).toBe(false);
    expect(spendAbility(abilities, 'peek')).toBe(false);
  });

  it('countUnusedAbilities counts one type, or every type when none is named', () => {
    const abilities: Ability<Power>[] = [];
    addAbility(abilities, 'reroll');
    addAbility(abilities, 'reroll');
    addAbility(abilities, 'peek');
    spendAbility(abilities, 'reroll');
    expect(countUnusedAbilities(abilities, 'reroll')).toBe(1);
    expect(countUnusedAbilities(abilities, 'peek')).toBe(1);
    expect(countUnusedAbilities(abilities)).toBe(2);
  });

  it('groupAbilities totals each type in first-earned order', () => {
    const abilities: Ability<Power>[] = [];
    addAbility(abilities, 'peek');
    addAbility(abilities, 'reroll');
    addAbility(abilities, 'peek');
    spendAbility(abilities, 'peek');
    expect(groupAbilities(abilities)).toEqual([
      { type: 'peek', total: 2, unused: 1 },
      { type: 'reroll', total: 1, unused: 1 },
    ]);
  });
});
