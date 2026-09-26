/**
 * A WORLD'S DURABLE STORE, IN MEMORY, for a test that drives one (#262).
 *
 * `boardsmith dev` keeps a world in SQLite because the capability it is
 * emulating is CROSS-SESSION state, and restarting the CLI is exactly the seam
 * a persistent world spans. A test spans no such seam: it wants the world a
 * host would have, built in a millisecond, with nothing on disk to clean up.
 *
 * WHAT IT STILL HAS TO GET RIGHT is the one thing the SQLite store exists for:
 * A CHECKPOINT IS ONE FACT WITH SEVERAL HALVES. The partitions a command
 * dirtied, the dirty marks they satisfy, the events it settled, the events it
 * armed, its receipt and its activity watermark all become true together. In
 * memory that is free -- nothing here yields between the first write and the
 * last -- which is why every method below is a plain synchronous mutation and
 * there is no transaction machinery to read.
 *
 * It is NOT a place to prove durability. A test about "the world is still there
 * after a restart" needs bytes that outlive a process, and that test lives
 * beside the store that has them (`world-store.durability.test.ts`).
 */
import {
  assertPartitionWithinBudget,
  assertStorablePartitionName,
  worldBudgets,
  EMPTY_NOTICE_BOX,
  isEmptyNoticeBox,
  type DeclaredSeatActivityStamp,
  type PlannedEvent,
  type StoredPartition,
  type WorldBudgets,
  type WorldCreatedPartition,
  type WorldGenesis,
  type WorldMigrated,
  type WorldReceipt,
  type WorldNoticeBox,
  type WorldSerialized,
} from '../world/index.js';
import {
  secondEndingRefused,
  storablePartitionRows,
  type WorldCheckpointExtras,
  type WorldSeatRecord,
  type WorldStore,
} from '../world/host/index.js';

/** One stored partition, as this store holds it: the bytes as a STRING, so a
 *  test cannot hand the engine the same object twice and prove adoption works
 *  without ever running it (`docs/TEST-FIXTURES.md`). */
interface PartitionRow {
  readonly parentId: number;
  json: string;
}

/**
 * Build a world store that lives for as long as the test does.
 *
 * `budgets` is passed rather than defaulted at each use for the reason every
 * other world surface takes it: a ceiling read rather than passed is one two
 * hosts can silently disagree about.
 */
export function createMemoryWorldStore(budgets: WorldBudgets = worldBudgets()): WorldStore {
  const partitions = new Map<string, PartitionRow>();
  const dirty = new Set<string>();
  const events = new Map<string, PlannedEvent>();
  const roster = new Map<string, { seat: number; seatedAt: number }>();
  const activity = new Map<number, number>();
  /** One box per seat with something waiting (ShufflewickPub #521). */
  const noticeBoxes = new Map<number, WorldNoticeBox>();
  const receipts = new Map<string, WorldReceipt>();
  let launched = false;
  let seq = 0;
  let stateVersion = 0;
  let allocation: number | undefined;
  let recordingSince: number | undefined;
  let receiptFloor = 0;
  let skewMs = 0;
  let endedAt: number | undefined;

  const receiptKey = (player: string, orderId: string): string => `${player}\u0000${orderId}`;

  /** The rows a write is about, checked BEFORE any of them lands. A partition
   *  this store has never held has no parent to hang a subtree from, and
   *  writing it under a guessed one would graft it into the wrong place. */
  function rowsFor(written: Record<string, string>): Array<{ name: string; json: string }> {
    return Object.entries(written).map(([name, json]) => {
      assertStorablePartitionName(name);
      assertPartitionWithinBudget(name, json, budgets);
      if (!partitions.has(name)) {
        throw new Error(
          `This world's store was asked to write partition "${name}", which it has never ` +
            'read or created. A partition is written under the parent it was created with, so ' +
            'there is nowhere to put this one. Create it through genesis or through ' +
            "`world.createPartition` before a command writes it.",
        );
      }
      return { name, json };
    });
  }

  function writePartitions(rows: readonly { name: string; json: string }[]): void {
    for (const row of rows) {
      partitions.get(row.name)!.json = row.json;
      dirty.delete(row.name);
    }
  }

  /** Insert-or-replace, so an event re-armed under its own id and one whose
   *  arguments a migration rewrote take the same path. */
  function writeEvents(planned: readonly PlannedEvent[]): void {
    for (const event of planned) events.set(event.id, event);
  }

  /**
   * THE ORDER LEDGER'S AND THE WATERMARK'S SHARE OF ONE CHECKPOINT (#195, #383).
   *
   * Part of the same write as the effects: "the world changed", "this order
   * changed it" and "this seat was here" become true together, or a crash
   * between them leaves an order whose effects are durable and whose receipt is
   * not -- and the page's retry then pays for it twice.
   */
  function writeLedger(extras: WorldCheckpointExtras): void {
    if (extras.receipt !== undefined) {
      receipts.set(receiptKey(extras.receipt.player, extras.receipt.orderId), extras.receipt);
    }
    if (extras.receiptFloorAt !== undefined && extras.receiptFloorAt > receiptFloor) {
      receiptFloor = extras.receiptFloorAt;
      // A world running for months does not keep every answer it ever gave.
      for (const [key, receipt] of receipts) {
        if (receipt.at < receiptFloor) receipts.delete(key);
      }
    }
    if (extras.activity !== undefined) {
      activity.set(extras.activity.seat, extras.activity.at);
    }
    // AN EMPTY BOX IS NO ROW (#521), so a seat with nothing waiting costs nothing.
    for (const { seat, box } of extras.notices ?? []) {
      if (isEmptyNoticeBox(box)) noticeBoxes.delete(seat);
      else noticeBoxes.set(seat, box);
    }
    releaseChair(extras.vacate);
  }

  /** A chair the world's clock handed on (#278), matched on both keys and
   *  taking the holder's watermark and notice box with it -- the rule is `WorldStore`'s
   *  `vacate`, and the SQLite store keeps the same one in SQL. */
  function releaseChair(
    vacancy: { readonly seat: number; readonly player: string } | undefined,
  ): void {
    if (vacancy === undefined) return;
    if (roster.get(vacancy.player)?.seat !== vacancy.seat) return;
    roster.delete(vacancy.player);
    activity.delete(vacancy.seat);
    noticeBoxes.delete(vacancy.seat);
  }

  return {
    async read(name: string): Promise<StoredPartition | undefined> {
      assertStorablePartitionName(name);
      const row = partitions.get(name);
      if (row === undefined) return undefined;
      return { parentId: row.parentId, json: JSON.parse(row.json) as unknown };
    },

    createOne(name: string, built: WorldCreatedPartition): void {
      // ALREADY THERE IS ALREADY DONE. Two declarations can reach for the same
      // absent root; the first writes it and the second must find that one
      // rather than replacing it with a fresh empty element.
      if (partitions.has(name)) return;
      assertStorablePartitionName(name);
      const json = JSON.stringify(built.partition.json);
      assertPartitionWithinBudget(name, json, budgets);
      partitions.set(name, { parentId: built.partition.parentId, json });
      allocation = built.nextElementId;
    },

    async createAll(genesis: WorldGenesis, version = 0): Promise<void> {
      // EVERY NAME AND EVERY SIZE FIRST, through the shared check: a genesis
      // refused for one bad name writes nothing at all -- the launched flag
      // most of all, because a world marked launched with nothing in it is
      // wedged forever.
      const rows = storablePartitionRows(genesis.partitions, budgets);
      for (const row of rows) partitions.set(row.name, { parentId: row.parentId, json: row.json });
      stateVersion = version;
      allocation = genesis.nextElementId;
      launched = true;
    },

    async writeCheckpoint(
      checkpoint: WorldSerialized,
      extras: WorldCheckpointExtras = {},
    ): Promise<void> {
      if (extras.endedAt !== undefined && endedAt !== undefined) throw secondEndingRefused(endedAt);
      const rows = rowsFor(checkpoint.partitions);
      writePartitions(rows);
      // THE STAMP LANDS WITH THE BYTES IT MINTED (#224).
      allocation = checkpoint.nextElementId;
      // SETTLED BEFORE ARMED, so a recurrence that re-arms under the id it just
      // ran is not deleted by its own settlement.
      for (const id of extras.settle ?? []) events.delete(id);
      writeEvents(extras.schedule ?? []);
      const highestSeq = (extras.schedule ?? []).reduce(
        (high, event) => Math.max(high, event.seq),
        -1,
      );
      // The sequence advances with the events that used it, never beside them.
      if (highestSeq >= 0) seq = Math.max(seq, highestSeq + 1);
      writeLedger(extras);
      // THE ENDING EMPTIES THE QUEUE IN THE SAME WRITE (#395).
      if (extras.endedAt !== undefined) {
        events.clear();
        endedAt = extras.endedAt;
      }
    },

    isLaunched: () => launched,

    dirtyPartitions: () => [...dirty],

    recordDirty(names: readonly string[]): void {
      for (const name of names) {
        assertStorablePartitionName(name);
        dirty.add(name);
      }
    },

    discardDirty(names: readonly string[]): void {
      for (const name of names) dirty.delete(name);
    },

    /** Ordered `(due, seq)`, the order `nextDueBatch` sorts by -- a world's
     *  behaviour must not depend on how a store happened to return ties. */
    pendingEvents: () =>
      [...events.values()].sort((a, b) => a.due - b.due || a.seq - b.seq),

    nextSeq: () => seq,

    seats: (): readonly WorldSeatRecord[] =>
      [...roster.entries()].map(([player, row]) => ({ player, seat: row.seat })),

    seat(player: string, seat: number, seatedAt: number): void {
      roster.set(player, { seat, seatedAt });
    },

    activitySince(openedAt: number): number {
      recordingSince ??= openedAt;
      return recordingSince;
    },

    activityOf(seat: number): DeclaredSeatActivityStamp {
      const chair = [...roster.values()].find((row) => row.seat === seat);
      const at = activity.get(seat);
      return {
        seat,
        // NULL IS THE ANSWER for a seat this world has not seen act since it
        // began recording, and it is a different answer from `since`.
        at: at === undefined ? null : at,
        // THE LATER OF THE TWO FLOORS (#423): the world's recording epoch, and
        // the instant this chair was granted. Measuring a newcomer from the
        // first would report them idle for the whole life of the world.
        since: Math.max(recordingSince ?? 0, chair?.seatedAt ?? 0),
        tenancy: chair === undefined ? 'empty' : 'held',
      };
    },

    noticeBox: (seat: number): WorldNoticeBox => noticeBoxes.get(seat) ?? EMPTY_NOTICE_BOX,

    receipt: (player: string, orderId: string): WorldReceipt | undefined =>
      receipts.get(receiptKey(player, orderId)),

    receiptFloorAt: () => receiptFloor,

    clockSkewMs: () => skewMs,

    endedAt: () => endedAt,

    advanceClock(byMs: number): number {
      if (!Number.isFinite(byMs) || byMs < 0) {
        throw new Error(
          `A world's clock only ever moves forward, so it cannot be advanced by ${byMs}ms.`,
        );
      }
      skewMs += byMs;
      return skewMs;
    },

    partitionNames: () => [...partitions.keys()],

    stateVersion: () => stateVersion,

    recordAllocation(nextElementId: number): void {
      allocation = nextElementId;
    },

    nextElementId: () => allocation,

    rekey({ partitions: written, events: planned, nextElementId }): void {
      const rows = rowsFor(written);
      writePartitions(rows);
      writeEvents(planned);
      // THE STAMP MOVES WITH THE IDS (#377).
      allocation = nextElementId;
    },

    migrate({ partitions: written, created, events: planned, toStateVersion }): void {
      const rows = rowsFor(written);
      // NEW ROOTS CARRY THEIR OWN PARENT, because there is no row to read one
      // from -- checked here, before anything lands, because a migration
      // refused halfway is the one failure this method exists to prevent.
      const minted = storablePartitionRows((created as WorldMigrated).created, budgets);
      writePartitions(rows);
      for (const row of minted) partitions.set(row.name, { parentId: row.parentId, json: row.json });
      writeEvents(planned);
      allocation = (created as WorldMigrated).nextElementId;
      // LAST: the version is the claim that everything above is written, so it
      // must not become true before they are.
      stateVersion = toStateVersion;
    },

    close(): void {
      // Nothing to release. Declared because a store is closed on the way out
      // and a host must not have to know which kind it holds.
    },
  };
}
