/**
 * #195: WHAT THE PAGE REMEMBERS ABOUT AN ORDER IT DID NOT HEAR AN ANSWER TO.
 */
import { describe, expect, it } from 'vitest';

import { ORDERS_KEPT, createOrderBook, type OrderStorage } from './orderBook.js';

/** A browser's storage, as a Map. Real enough: the contract is three string
 *  methods, and the shipped one is `localStorage`. */
function memoryStorage(seed: Record<string, string> = {}): OrderStorage & { store: Map<string, string> } {
  const store = new Map(Object.entries(seed));
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

/** A storage that refuses everything, which is a browser with site data
 *  blocked. */
const refusing: OrderStorage = {
  getItem() {
    throw new Error('site data is blocked');
  },
  setItem() {
    throw new Error('site data is blocked');
  },
  removeItem() {
    throw new Error('site data is blocked');
  },
};

const book = (storage: OrderStorage | null, ids = ['o1', 'o2', 'o3']) => {
  let minted = 0;
  return createOrderBook({
    key: 'k',
    storage,
    now: () => 5_000,
    mintId: () => ids[minted++] ?? `extra-${minted}`,
  });
};

describe('the order book', () => {
  it('writes an order down as it is opened, before its command could be sent', () => {
    const storage = memoryStorage();
    const order = book(storage).open(3, 'found', { name: 'Ceres' });
    expect(order).toEqual({ id: 'o1', seat: 3, at: 5_000, action: 'found', args: { name: 'Ceres' } });
    expect(JSON.parse(storage.store.get('k') as string)).toEqual([order]);
  });

  it('strikes one out once its fate is known', () => {
    const storage = memoryStorage();
    const one = book(storage);
    one.open(3, 'found', {});
    one.settle('o1');
    expect(one.pending(3)).toEqual([]);
    expect(JSON.parse(storage.store.get('k') as string)).toEqual([]);
  });

  it('leaves an unanswered order for the next page to find', () => {
    // THE WHOLE POINT. A reload is a new book over the same storage.
    const storage = memoryStorage();
    const one = book(storage);
    one.open(3, 'found', { name: 'Ceres' });
    one.open(3, 'build', { what: 'shipyard' });
    one.settle('o2');

    const reloaded = book(storage, ['o9']);
    expect(reloaded.pending(3)).toEqual([
      { id: 'o1', seat: 3, at: 5_000, action: 'found', args: { name: 'Ceres' } },
    ]);
  });

  it("does not erase another tab's orders when it writes (#889)", () => {
    // Two tabs open on one world are two books over one storage.
    const storage = memoryStorage();
    const first = book(storage, ['a1']);
    const second = book(storage, ['b1', 'b2']);
    first.open(3, 'found', {});
    second.open(3, 'chat', {});
    expect(first.pending(3).map((order) => order.id)).toEqual(['a1', 'b1']);

    second.open(3, 'wave', {});
    second.settle('b1');
    first.settle('nothing-of-mine');
    expect(book(storage, []).pending(3).map((order) => order.id)).toEqual(['a1', 'b2']);
  });

  it('ignores a stored order with no seat, since no seat may ask about it (#889)', () => {
    const stored = JSON.stringify([{ id: 'old', at: 1, action: 'found', args: {} }]);
    expect(book(memoryStorage({ k: stored })).pending(3)).toEqual([]);
  });

  it('gives each seat only the orders it sent (#889)', () => {
    // The host keeps receipts per player, so one seat re-sending another's order
    // would run it a second time, as the wrong player.
    const storage = memoryStorage();
    const one = book(storage);
    one.open(3, 'found', {});
    one.open(5, 'build', {});
    expect(book(storage, []).pending(5).map((order) => order.id)).toEqual(['o2']);
    expect(book(storage, []).pending(3).map((order) => order.id)).toEqual(['o1']);
  });

  it('keeps the arguments, so a retry need not ask the player to choose again', () => {
    const storage = memoryStorage();
    book(storage).open(3, 'build', { site: 'plot-4', tier: 2 });
    expect(book(storage, ['o9']).pending(3)[0]?.args).toEqual({ site: 'plot-4', tier: 2 });
  });

  it('is bounded, because a page that hears nothing for a month is not a ledger', () => {
    const storage = memoryStorage();
    const many = createOrderBook({ key: 'k', storage, now: () => 1, mintId: mintCounter() });
    for (let i = 0; i < ORDERS_KEPT + 5; i++) many.open(3, 'chop', {});
    expect(many.pending(3)).toHaveLength(ORDERS_KEPT);
    // The oldest go: they are the ones least likely to still be answerable.
    expect(many.pending(3)[0]?.id).toBe('order-6');
  });

  it('ignores a book that is not one, rather than refusing to run the world', () => {
    expect(book(memoryStorage({ k: 'not json' })).pending(3)).toEqual([]);
    expect(book(memoryStorage({ k: '{"orders":1}' })).pending(3)).toEqual([]);
    expect(book(memoryStorage({ k: '[{"id":""}]' })).pending(3)).toEqual([]);
  });

  it('still acts with no storage at all, and says it is not durable', () => {
    for (const storage of [null, refusing]) {
      const nowhere = book(storage);
      // A browser with site data blocked hands out a storage object that throws
      // on every call, so "durable" is about what works, not what was handed
      // over.
      expect(nowhere.durable).toBe(false);
      expect(nowhere.open(3, 'found', {}).id).toBe('o1');
      // It acted; what it cannot do is find that order again after a reload.
      expect(book(storage, ['o9']).pending(3)).toEqual([]);
    }
  });
});

function mintCounter(): () => string {
  let n = 0;
  return () => `order-${(n += 1)}`;
}
