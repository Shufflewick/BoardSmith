/**
 * THE PAGE'S HALF OF AN ORDER'S DURABLE IDENTITY (#195).
 *
 * A world's host answers a repeat of an order it committed from that order's
 * receipt, which is what makes a lost reply harmless -- but only if the page
 * can still say WHICH ORDER it was uncertain about after a reload. An id held
 * in a component's memory does not survive the one event it exists for.
 *
 * So an order is written down BEFORE the command is sent and struck out only
 * when an authoritative answer arrives. What is left in the book after a reload
 * is exactly the set of orders whose fate this page does not know, and each one
 * carries everything needed to ask again: its id, its mint instant, its action
 * and its arguments.
 *
 * ## Why the arguments are kept too
 *
 * A retry is the SAME order, and the host answers it from the receipt without
 * re-enumerating anything -- but a retry of an order that never committed has
 * to run, and running it needs what the player chose. Keeping the arguments is
 * what lets that happen without asking the player to choose again, and without
 * the game keeping a candidate it has already consumed.
 *
 * ## When there is no storage
 *
 * A browser with storage refused or full still acts: an order gets its identity
 * and its command is sent. What it loses is RECOVERY across a reload, and that
 * loss is reported (`durable`) rather than hidden, because a page that quietly
 * cannot recover an uncertain order looks exactly like one that has nothing to
 * recover.
 */

/** One order this page has sent and not yet heard an authoritative answer to. */
export interface PendingOrder {
  readonly id: string;
  /** When this page minted it. The host reads it to tell an order that never
   *  committed from one whose receipt has been swept. */
  readonly at: number;
  readonly action: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/** The slice of `Storage` this needs, so a test hands it a Map and a page hands
 *  it `localStorage`. */
export interface OrderStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface OrderBookOptions {
  /** Where the book is kept. One key per world surface. */
  key?: string;
  storage?: OrderStorage | null;
  now?: () => number;
  mintId?: () => string;
}

export interface OrderBook {
  /** Whether this book survives a reload. False when the browser refused
   *  storage, and the shell says so rather than promising recovery it cannot
   *  do. */
  readonly durable: boolean;
  /** Mint and write down an order, before its command is sent. */
  open(action: string, args: Record<string, unknown>): PendingOrder;
  /** Strike one out: its fate is known. */
  settle(id: string): void;
  /** Every order whose fate this page still does not know, oldest first. */
  pending(): readonly PendingOrder[];
}

/**
 * The key prefix. SCOPED BY PATH, and that is not tidiness: a platform serves
 * many worlds from one origin, so a single key would let an order minted in one
 * world be re-sent into another -- where it has no receipt, and would simply
 * run.
 */
const ORDER_BOOK_KEY = 'boardsmith.world.orders';

/** The book's key for the surface this page is. */
export function orderBookKey(path: string): string {
  return `${ORDER_BOOK_KEY}:${path}`;
}

/**
 * How many uncertain orders a page keeps.
 *
 * Uncertainty is rare -- one lost reply, not a hundred -- so a book that has
 * grown past this is a page that has been failing to hear answers for a long
 * time, and the oldest entries are the ones least likely to still be
 * answerable. Bounded so a book cannot grow without limit in a browser that
 * never gets a reply.
 */
export const ORDERS_KEPT = 32;

export function createOrderBook(options: OrderBookOptions = {}): OrderBook {
  const key = options.key ?? orderBookKey(currentPath());
  const now = options.now ?? (() => Date.now());
  const mintId = options.mintId ?? defaultMintId;
  const storage = usable(options.storage === undefined ? browserStorage() : options.storage, key);

  let orders: PendingOrder[] = read();

  function read(): PendingOrder[] {
    if (storage === null) return [];
    try {
      const raw = storage.getItem(key);
      if (raw === null) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isPendingOrder);
    } catch {
      // A book that cannot be read is a book with nothing in it. It is not an
      // error a player can act on, and refusing to run the world over it would
      // trade a lost recovery for a dead page.
      return [];
    }
  }

  function write(): void {
    if (storage === null) return;
    try {
      storage.setItem(key, JSON.stringify(orders));
    } catch {
      // Same reasoning as `read`, and `durable` already says this may happen.
    }
  }

  return {
    durable: storage !== null,

    open(action, args) {
      const order: PendingOrder = {
        id: mintId(),
        at: now(),
        action,
        // The same round trip `act` does on the way to the wire: a Vue proxy
        // cannot be stored any more than it can be posted.
        args: JSON.parse(JSON.stringify(args ?? {})) as Record<string, unknown>,
      };
      orders = [...orders, order].slice(-ORDERS_KEPT);
      write();
      return order;
    },

    settle(id) {
      const kept = orders.filter((order) => order.id !== id);
      if (kept.length === orders.length) return;
      orders = kept;
      write();
    },

    pending() {
      return orders;
    },
  };
}

function isPendingOrder(value: unknown): value is PendingOrder {
  if (typeof value !== 'object' || value === null) return false;
  const order = value as Partial<PendingOrder>;
  return (
    typeof order.id === 'string' &&
    order.id.length > 0 &&
    typeof order.at === 'number' &&
    Number.isFinite(order.at) &&
    typeof order.action === 'string' &&
    typeof order.args === 'object' &&
    order.args !== null
  );
}

/**
 * The storage, or nothing when this page has none that WORKS.
 *
 * Probed by using it, because a browser with site data blocked hands out a
 * `localStorage` object that throws on every call -- and `durable` has to be a
 * statement about what the page can actually do, not about which object it was
 * handed.
 */
function usable(storage: OrderStorage | null, key: string): OrderStorage | null {
  if (storage === null) return null;
  try {
    const probe = `${key}:probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    storage.getItem(key);
    return storage;
  } catch {
    return null;
  }
}

/** `localStorage`, or nothing when this page has none it may use. */
function browserStorage(): OrderStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The world surface this page is, as the book's scope. A page with no
 *  location -- a component test, an embedded runtime -- is one surface. */
function currentPath(): string {
  try {
    return typeof location === 'undefined' ? '' : location.pathname;
  } catch {
    return '';
  }
}

function defaultMintId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // A page without `crypto.randomUUID` still needs an id no other order of this
  // page's will collide with; uniqueness here is per-seat and per-book, not
  // global.
  return `order-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
