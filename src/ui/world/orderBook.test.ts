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
    const order = book(storage).open('found', { name: 'Ceres' });
    expect(order).toEqual({ id: 'o1', at: 5_000, action: 'found', args: { name: 'Ceres' } });
    expect(JSON.parse(storage.store.get('k') as string)).toEqual([order]);
  });

  it('strikes one out once its fate is known', () => {
    const storage = memoryStorage();
    const one = book(storage);
    one.open('found', {});
    one.settle('o1');
    expect(one.pending()).toEqual([]);
    expect(JSON.parse(storage.store.get('k') as string)).toEqual([]);
  });

  it('leaves an unanswered order for the next page to find', () => {
    // THE WHOLE POINT. A reload is a new book over the same storage.
    const storage = memoryStorage();
    const one = book(storage);
    one.open('found', { name: 'Ceres' });
    one.open('build', { what: 'shipyard' });
    one.settle('o2');

    const reloaded = book(storage, ['o9']);
    expect(reloaded.pending()).toEqual([
      { id: 'o1', at: 5_000, action: 'found', args: { name: 'Ceres' } },
    ]);
  });

  it('keeps the arguments, so a retry need not ask the player to choose again', () => {
    const storage = memoryStorage();
    book(storage).open('build', { site: 'plot-4', tier: 2 });
    expect(book(storage, ['o9']).pending()[0]?.args).toEqual({ site: 'plot-4', tier: 2 });
  });

  it('is bounded, because a page that hears nothing for a month is not a ledger', () => {
    const storage = memoryStorage();
    const many = createOrderBook({ key: 'k', storage, now: () => 1, mintId: mintCounter() });
    for (let i = 0; i < ORDERS_KEPT + 5; i++) many.open('chop', {});
    expect(many.pending()).toHaveLength(ORDERS_KEPT);
    // The oldest go: they are the ones least likely to still be answerable.
    expect(many.pending()[0]?.id).toBe('order-6');
  });

  it('ignores a book that is not one, rather than refusing to run the world', () => {
    expect(book(memoryStorage({ k: 'not json' })).pending()).toEqual([]);
    expect(book(memoryStorage({ k: '{"orders":1}' })).pending()).toEqual([]);
    expect(book(memoryStorage({ k: '[{"id":""}]' })).pending()).toEqual([]);
  });

  it('still acts with no storage at all, and says it is not durable', () => {
    for (const storage of [null, refusing]) {
      const nowhere = book(storage);
      // A browser with site data blocked hands out a storage object that throws
      // on every call, so "durable" is about what works, not what was handed
      // over.
      expect(nowhere.durable).toBe(false);
      expect(nowhere.open('found', {}).id).toBe('o1');
      // It acted; what it cannot do is find that order again after a reload.
      expect(book(storage, ['o9']).pending()).toEqual([]);
    }
  });
});

function mintCounter(): () => string {
  let n = 0;
  return () => `order-${(n += 1)}`;
}
