import { describe, it, expect } from 'vitest';
import { AbilityManager } from './abilities.js';

type Power = 'reroll' | 'peek' | 'swap';

const withAbilities = (...types: Power[]): AbilityManager<Power> => {
  const manager = new AbilityManager<Power>();
  for (const type of types) manager.add(type);
  return manager;
};

describe('AbilityManager', () => {
  it('starts with nothing', () => {
    const manager = new AbilityManager<Power>();
    expect(manager.getAll()).toEqual([]);
    expect(manager.countAllUnused()).toBe(0);
    expect(manager.has('reroll')).toBe(false);
  });

  describe('add', () => {
    it('records a new ability as unused', () => {
      const manager = withAbilities('reroll');
      expect(manager.getAll()).toEqual([{ type: 'reroll', used: false, earnedFrom: undefined }]);
    });

    it('keeps the provenance when given', () => {
      const manager = new AbilityManager<Power>();
      manager.add('peek', 'round-2 bonus');
      expect(manager.getAll()[0].earnedFrom).toBe('round-2 bonus');
    });

    it('stacks duplicates of the same type', () => {
      const manager = withAbilities('reroll', 'reroll');
      expect(manager.count('reroll')).toBe(2);
      expect(manager.countUnused('reroll')).toBe(2);
    });
  });

  describe('has / hasUnused', () => {
    it('has stays true after the ability is spent', () => {
      const manager = withAbilities('reroll');
      manager.use('reroll');
      expect(manager.has('reroll')).toBe(true);
      expect(manager.hasUnused('reroll')).toBe(false);
    });

    it('hasUnused stays true while a second copy is unspent', () => {
      const manager = withAbilities('reroll', 'reroll');
      manager.use('reroll');
      expect(manager.hasUnused('reroll')).toBe(true);
    });

    it('both are false for a type the player never earned', () => {
      const manager = withAbilities('reroll');
      expect(manager.has('peek')).toBe(false);
      expect(manager.hasUnused('peek')).toBe(false);
    });
  });

  describe('counting', () => {
    it('count includes spent copies, countUnused does not', () => {
      const manager = withAbilities('reroll', 'reroll', 'peek');
      manager.use('reroll');
      expect(manager.count('reroll')).toBe(2);
      expect(manager.countUnused('reroll')).toBe(1);
    });

    it('countAllUnused spans every type', () => {
      const manager = withAbilities('reroll', 'peek', 'swap');
      expect(manager.countAllUnused()).toBe(3);
      manager.use('peek');
      expect(manager.countAllUnused()).toBe(2);
    });

    it('counts zero for an unknown type', () => {
      const manager = withAbilities('reroll');
      expect(manager.count('swap')).toBe(0);
      expect(manager.countUnused('swap')).toBe(0);
    });
  });

  describe('use', () => {
    it('spends one copy and reports success', () => {
      const manager = withAbilities('reroll', 'reroll');
      expect(manager.use('reroll')).toBe(true);
      expect(manager.countUnused('reroll')).toBe(1);
    });

    it('reports failure without changing anything when none are left', () => {
      const manager = withAbilities('reroll');
      manager.use('reroll');
      expect(manager.use('reroll')).toBe(false);
      expect(manager.getUsed()).toHaveLength(1);
    });

    it('reports failure for a type the player never had', () => {
      expect(new AbilityManager<Power>().use('reroll')).toBe(false);
    });

    it('spends only the requested type', () => {
      const manager = withAbilities('reroll', 'peek');
      manager.use('reroll');
      expect(manager.hasUnused('peek')).toBe(true);
    });

    it('spends the oldest copy first', () => {
      const manager = new AbilityManager<Power>();
      manager.add('reroll', 'first');
      manager.add('reroll', 'second');
      manager.use('reroll');
      expect(manager.getUsed()[0].earnedFrom).toBe('first');
    });
  });

  describe('queries', () => {
    it('getUnused and getUsed partition the abilities', () => {
      const manager = withAbilities('reroll', 'peek');
      manager.use('reroll');
      expect(manager.getUnused().map((a) => a.type)).toEqual(['peek']);
      expect(manager.getUsed().map((a) => a.type)).toEqual(['reroll']);
    });

    it('getTypes de-duplicates and keeps first-seen order', () => {
      const manager = withAbilities('peek', 'reroll', 'peek');
      expect(manager.getTypes()).toEqual(['peek', 'reroll']);
    });

    it('getTypes still lists a fully spent type', () => {
      const manager = withAbilities('reroll');
      manager.use('reroll');
      expect(manager.getTypes()).toEqual(['reroll']);
    });

    it('getGrouped reports totals and remaining per type', () => {
      const manager = withAbilities('reroll', 'reroll', 'peek');
      manager.use('reroll');
      expect(manager.getGrouped()).toEqual([
        { type: 'reroll', total: 2, unused: 1 },
        { type: 'peek', total: 1, unused: 1 },
      ]);
    });

    it('getGrouped is empty for an empty manager', () => {
      expect(new AbilityManager<Power>().getGrouped()).toEqual([]);
    });
  });

  describe('resetAll / clear', () => {
    it('resetAll makes every ability available again', () => {
      const manager = withAbilities('reroll', 'peek');
      manager.use('reroll');
      manager.use('peek');
      manager.resetAll();
      expect(manager.countAllUnused()).toBe(2);
      expect(manager.getUsed()).toEqual([]);
    });

    it('resetAll keeps the abilities themselves', () => {
      const manager = withAbilities('reroll');
      manager.use('reroll');
      manager.resetAll();
      expect(manager.count('reroll')).toBe(1);
    });

    it('clear removes everything', () => {
      const manager = withAbilities('reroll', 'peek');
      manager.clear();
      expect(manager.getAll()).toEqual([]);
      expect(manager.has('reroll')).toBe(false);
    });
  });

  describe('serialization', () => {
    it('round-trips through the instance fromJSON', () => {
      const manager = withAbilities('reroll', 'peek');
      manager.use('reroll');
      const restored = new AbilityManager<Power>();
      restored.fromJSON(manager.toJSON());
      expect(restored.getAll()).toEqual(manager.getAll());
    });

    it('round-trips through the static factory', () => {
      const manager = withAbilities('reroll', 'reroll');
      manager.use('reroll');
      const restored = AbilityManager.fromJSON(manager.toJSON());
      expect(restored.countUnused('reroll')).toBe(1);
      expect(restored.count('reroll')).toBe(2);
    });

    it('toJSON copies each ability so later use() cannot alter the snapshot', () => {
      const manager = withAbilities('reroll');
      const snapshot = manager.toJSON();
      manager.use('reroll');
      expect(snapshot[0].used).toBe(false);
    });

    it('fromJSON copies each ability so the source data stays independent', () => {
      const data = [{ type: 'reroll' as const, used: false }];
      const manager = new AbilityManager<Power>();
      manager.fromJSON(data);
      manager.use('reroll');
      expect(data[0].used).toBe(false);
    });

    it('fromJSON replaces rather than appends', () => {
      const manager = withAbilities('reroll', 'peek');
      manager.fromJSON([{ type: 'swap', used: false }]);
      expect(manager.getTypes()).toEqual(['swap']);
    });

    it('preserves the provenance across a round trip', () => {
      const manager = new AbilityManager<Power>();
      manager.add('peek', 'from the oracle');
      expect(AbilityManager.fromJSON(manager.toJSON()).getAll()[0].earnedFrom)
        .toBe('from the oracle');
    });
  });
});
