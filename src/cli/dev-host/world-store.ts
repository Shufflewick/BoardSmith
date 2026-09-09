/**
 * THE LOCAL WORLD STORE: where a laptop's persistent world actually lives.
 *
 * `boardsmith/world` reads partitions through `WorldPartitionStore` and hands a
 * checkpoint back through `WorldPartitionWriter`. On the hosting platform the
 * other end of those two interfaces is a Cloudflare Durable Object
 * (`games/src/world-partition-store.ts`). On a laptop it is this file, and the
 * pair is the whole of #164's promise: the same world, the same budgets, the
 * same refusals, with no cloud infrastructure anywhere.
 *
 * It is the world-side sibling of `persistence-file-store.ts` and exists for
 * the same reason that one does. The capability being emulated is CROSS-SESSION
 * state, so an in-memory store proves nothing: restarting `boardsmith dev` is
 * exactly the seam a persistent world spans.
 *
 * ## WHY SQLITE AND NOT FILES -- ATOMICITY, NOT SIZE
 *
 * The obvious local store is a directory of JSON files, one per partition, the
 * way `persistence-file-store.ts` keeps one file for the whole table store.
 * Size is not what rules that out: measured partitions run 11 KB to 72 KB and
 * are capped at 512 KB, so even a 1,600-sector world is under 20 MB.
 *
 * What rules it out is that A CHECKPOINT IS ONE FACT WITH THREE HALVES. It
 * writes the partitions a command dirtied, it clears those names from the dirty
 * set, and it settles and re-arms the schedule -- and either all of that is
 * durable or none of it is. A file store interrupted between two of those
 * writes leaves a TORN WORLD: rooms that disagree about which command last ran,
 * a scheduled event that has already been paid, a dirty set that says clean
 * about bytes that were never written. Nothing downstream can detect any of it,
 * and that seam is the exact one a local store exists to prove, because the
 * platform's Durable Object storage commits those writes together and a laptop
 * that did not would make "the same world in both places" false.
 *
 * SQLite gives that guarantee as a transaction, so `writeCheckpoint` below is
 * one `BEGIN IMMEDIATE ... COMMIT` and nothing more.
 *
 * ## WHY `node:sqlite` AND NOT `better-sqlite3`
 *
 * `node:sqlite` is built into Node, so it adds no dependency and no native
 * build step. `better-sqlite3` would keep the Node floor at `>=20` but would
 * put a compiler in front of every author who types `npm install boardsmith`,
 * which is the opposite of what #164 is for. The price is BoardSmith's
 * `engines.node` floor rising to `>=22.5`, which is paid deliberately and once.
 *
 * ## WHY A DIRECTORY, AND NOT UNDER `.boardsmith/`
 *
 * `boardsmith dev` deletes `.boardsmith/` on shutdown -- it is the rules-bundle
 * scratch directory -- so a store kept there would be erased by the one event
 * it has to survive. It goes beside `boardsmith.json` instead, exactly as the
 * table dev store does.
 *
 * A DIRECTORY rather than the table store's single dotfile, because SQLite owns
 * more than one file: `world.db` is accompanied by `world.db-wal` and
 * `world.db-shm` while the database is open, and a rollback of the last
 * transaction is read out of them. One directory keeps them together, makes the
 * ignore rule one line, and makes `boardsmith dev --reset` one removal that
 * cannot leave a sidecar behind describing a database that is gone.
 *
 * ## WHAT IS NOT STORED, AND THAT IS DELIBERATE
 *
 * CONNECTION PRESENCE. `WorldCommandStamp.presence` is explicit that it is
 * "derived per command and never stored", because a persisted claim about who
 * holds a socket is falsified by the first restart -- a world woken hours later
 * would be handed a memory of an audience that went home. What IS durable is
 * the ROSTER: which player holds which seat, which is where their holdings are.
 * `seat`/`seats` below are that ledger, and who is currently *watching* is the
 * host's own answer from its open connections at the instant it asks.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type {
  SeatActivityStamp,
  StoredPartition,
  WorldPartitionStore,
} from '../../world/contract.js';
import {
  assertPartitionWithinBudget,
  assertStorablePartitionName,
  type WorldPartitionWriter,
} from '../../world/partition-store.js';
import type {
  WorldCreatedPartition,
  WorldGenesis,
  WorldMigrated,
  WorldSerialized,
} from '../../world/runner.js';
import type { PlannedEvent } from '../../world/schedule-api.js';
import type { WorldBudgets } from '../../world/budgets.js';
import type { WorldReceipt } from '../../world/orders.js';

/**
 * The lowest Node that has `node:sqlite`.
 *
 * Named rather than spelled inside the check, because the same number is the
 * one `package.json`'s `engines.node` declares and the one the error message
 * has to tell an author to install.
 */
export const REQUIRED_NODE_VERSION = '22.5.0';

/** Where a project's local world store lives, given the project root. */
export function worldStoreDir(projectRoot: string): string {
  return join(projectRoot, '.boardsmith-dev-world');
}

/** The database file inside it. */
export function worldStorePath(projectRoot: string): string {
  return join(worldStoreDir(projectRoot), 'world.db');
}

/**
 * Delete this project's world store, for `boardsmith dev --reset`.
 *
 * EXPLICIT AND NEVER ON SHUTDOWN. A persistent world that erased itself when
 * its host stopped would be a session, and the one thing an author has to be
 * able to do is close the laptop. So the only thing that removes a world is
 * somebody asking for a new one.
 *
 * Answers whether anything was there, so the caller can say "reset" or
 * "nothing to reset" rather than guessing.
 */
export function resetWorldStore(projectRoot: string): boolean {
  const dir = worldStoreDir(projectRoot);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * What `boardsmith dev --reset` says it did.
 *
 * Returned rather than printed so the wording is testable, and worded so that
 * "nothing was there" is a normal answer rather than something that reads like
 * a failure: resetting a world that has never been played is exactly what
 * somebody does when they are not sure whether one exists.
 */
export function worldResetNotice(removed: boolean, dir: string): string {
  return removed
    ? `--reset: deleted the local world at ${dir}. The next command runs genesis again.`
    : `--reset: no local world at ${dir} yet, so there was nothing to delete.`;
}

/** One seat, as the roster holds it. Reachable without being exported: `seats()`
 *  answers one and TypeScript checks a caller's use of it structurally, the same
 *  way `runner.ts` keeps `SchedulePlan` unexported. A name nothing imports is a
 *  public surface larger than its callers. */
interface WorldSeatRecord {
  readonly player: string;
  readonly seat: number;
}

/**
 * A durable local world.
 *
 * `WorldPartitionStore` and `WorldPartitionWriter` are the two halves the
 * library already names; everything else on it is the state a host has to keep
 * beside the partitions and that has to survive the same restart -- the
 * launched flag, the dirty set, the schedule and the roster.
 */
export interface LocalWorldStore extends WorldPartitionStore, WorldPartitionWriter {
  /** The database file this store is open on. */
  readonly path: string;

  /**
   * `WorldPartitionWriter.writeCheckpoint`, WIDENED to carry what settles and
   * arms with it.
   *
   * The library's signature is the partitions alone, because that is all a
   * store must be able to do. This one takes the schedule too, for the reason
   * the Durable Object store takes `alsoDelete`/`alsoPut`: an event's deletion
   * has to commit in the same write as its effects, and a command's timers must
   * not become durable before the checkpoint that makes their cause durable.
   * The extra argument is optional, so this is still a `WorldPartitionWriter`
   * everywhere one is asked for.
   */
  writeCheckpoint(
    checkpoint: WorldSerialized,
    extras?: WorldCheckpointExtras,
  ): Promise<void>;

  /**
   * `WorldPartitionWriter.createAll`, WIDENED to record the state version
   * genesis wrote under (#200).
   *
   * The library's signature is the genesis answer alone; what ELSE lands with a
   * genesis is each host's own storage business, and for this one it is the
   * version. Optional, so this is still a `WorldPartitionWriter`.
   */
  createAll(genesis: WorldGenesis, stateVersion?: number): Promise<void>;

  /**
   * Has genesis already run?
   *
   * The flag is written IN THE SAME TRANSACTION as the genesis partitions
   * (`createAll`), which is what makes a launch all-or-nothing: a reopened
   * store finds either an empty world or a launched one, and never the state in
   * between -- a world marked launched with nothing in it, which refuses every
   * command it ever receives for a missing partition whose absence nothing
   * explains.
   */
  isLaunched(): boolean;

  /** Every partition name whose live bytes are not yet durable. */
  dirtyPartitions(): readonly string[];

  /**
   * Accumulate what a command dirtied.
   *
   * Its own write, deliberately: recording dirt PRECEDES the checkpoint rather
   * than being part of it, and a restart that finds a non-empty dirty set is
   * being told the truth -- those partitions' durable bytes are older than the
   * last command that ran, because the host stopped before it checkpointed.
   */
  recordDirty(names: readonly string[]): void;

  /**
   * FORGET THAT THESE PARTITIONS WERE EVER DIRTY, because the live bytes they
   * were about are gone.
   *
   * The only caller is a host that has just THROWN ITS RESIDENT WORLD AWAY --
   * `boardsmith dev`'s answer to a checkpoint that would not land, and the
   * platform's `discardChild` by another name. A dirty mark says "this
   * partition's durable bytes are older than the live tree"; once there is no
   * live tree, that sentence is false, and a mark nobody can ever satisfy would
   * make every later checkpoint try to serialize a partition no engine holds.
   *
   * It is NOT a way to skip a checkpoint. Discarding a mark without discarding
   * the residency it describes is exactly the corruption `writeCheckpoint`'s
   * one-transaction rule exists to prevent, which is why this is documented
   * against that single caller and against no other.
   */
  discardDirty(names: readonly string[]): void;

  /**
   * Every pending scheduled event, ordered `(due, seq)`.
   *
   * The same order `nextDueBatch` sorts by, because a world's behaviour must
   * not depend on how a storage engine happened to return ties.
   */
  pendingEvents(): readonly PlannedEvent[];

  /**
   * The next monotonic insertion sequence for a scheduled event.
   *
   * Advanced BY THE CHECKPOINT, in the transaction that makes the events using
   * it durable. A counter bumped outside that transaction would keep counting
   * through a rolled-back checkpoint, which is a gap in an ordering that exists
   * only to break ties deterministically.
   */
  nextSeq(): number;

  /** The roster: which player holds which seat. Durable the instant it is
   *  granted, because a seat is where a player's holdings are. */
  seats(): readonly WorldSeatRecord[];

  /** Record that `player` holds `seat`. */
  seat(player: string, seat: number): void;

  /**
   * WHEN THIS WORLD BEGAN WATCHING (ShufflewickPub #383), fixing it on the
   * first call and answering the same instant forever after.
   *
   * Called once when a host opens the world, BEFORE any command runs, because
   * a seat's idleness is measured from here and `activityOf` refuses rather
   * than invent an epoch. Taking `openedAt` rather than reading a clock keeps
   * the store testable and keeps the host the only thing that knows what time
   * it is -- the same split `advanceClock` already makes.
   */
  activitySince(openedAt: number): number;

  /**
   * THIS SEAT'S DURABLE ACTIVITY WATERMARK (ShufflewickPub #383).
   *
   * A POINT READ, per seat, which is the whole reason it is a table and not a
   * scan: a five-hundred-seat world answering "is this empire idle" must not
   * read four hundred and ninety-nine other empires to do it. Answers for any
   * seat, including one that has never acted -- `at: null` -- so a caller never
   * has to distinguish "no row" from "no activity".
   */
  activityOf(seat: number): SeatActivityStamp;

  /**
   * THE STATE VERSION THIS WORLD'S BYTES WERE LAST WRITTEN UNDER (#200).
   *
   * Zero for a world that has never recorded one, which is the same default
   * `boardsmith build` writes into a manifest -- so a world launched before
   * versions existed and one whose author declared 0 are the same world, and
   * neither is asked to migrate to reach 0.
   */
  stateVersion(): number;

  /**
   * THE WORLD'S DURABLE ID ALLOCATION STAMP (ShufflewickPub #377).
   *
   * The next element id this world may mint, as the last write that minted one
   * left it. `undefined` for a world written before the stamp existed -- the
   * host derives one from the stored bytes ONCE and writes it, rather than
   * being handed a number nothing can vouch for.
   */
  nextElementId(): number | undefined;

  /**
   * WRITE THE STAMP A WORLD SHOULD ALWAYS HAVE HAD (ShufflewickPub #377).
   *
   * The one repair door, for a world launched before the stamp existed. Every
   * other write that moves the allocation carries it in the transaction that
   * minted the ids; this one has no ids to carry, because it is derived from
   * bytes that are already durable.
   */
  recordAllocation(nextElementId: number): void;

  /** Every partition this world holds, by name. A migration is the one caller:
   *  it transforms all of them, and nothing else in this host ever wants the
   *  whole list (that would be the O(world) read residency exists to delete). */
  partitionNames(): readonly string[];

  /**
   * A MIGRATION, WRITTEN WHOLE OR NOT AT ALL (#200).
   *
   * Every transformed partition, every queued event's new arguments, and the
   * version they are now written under, in ONE transaction. A migration that
   * landed halfway would be a world whose rooms disagree about which rules
   * wrote them -- and unlike a checkpoint there is no retry that could finish
   * it, because the second attempt would read bytes the first had already
   * moved.
   */
  migrate(migrated: {
    partitions: Record<string, string>;
    /**
     * NEW partition roots this migration adds (#218), each with the parent it
     * hangs from -- which a transformed partition does not need, because its
     * row already records one.
     */
    created: WorldMigrated;
    events: readonly PlannedEvent[];
    toStateVersion: number;
  }): void;

  /**
   * LIFT THIS WORLD'S ELEMENT IDS ABOVE THE CONSTRUCTION FLOOR (#223).
   *
   * Every partition and every queued event, rewritten with one offset, in ONE
   * transaction -- for the reason `migrate` is one transaction, and one more:
   * a world half lifted is a world whose partitions disagree about what an id
   * means, and its references point at nothing. There is no retry that could
   * finish it, because the second attempt would shift bytes the first had
   * already shifted.
   */
  rekey(lifted: {
    partitions: Record<string, string>;
    events: readonly PlannedEvent[];
    /** The stamp, moved by the same offset as the ids (#377). */
    nextElementId: number;
  }): void;

  /**
   * RECORD A PARTITION ROOT BUILT ON FIRST USE (#218).
   *
   * Its own write, and deliberately not part of a checkpoint: it happens while
   * a declaration is still settling, before anything has decided whether the
   * command will run at all. An empty root written for a command that then
   * refuses is the correct outcome -- the partition exists, the command did
   * not, and the next reach finds the root rather than building a second one.
   *
   * Writing a name the store already holds is a no-op, so a race between two
   * declarations reaching for the same absent root leaves one partition.
   */
  createOne(name: string, built: WorldCreatedPartition): void;

  /**
   * WHAT THIS SEAT'S ORDER COMMITTED, if this store still holds its receipt
   * (#195).
   *
   * Keyed by player as well as order id, so one seat can never replay another's
   * order by guessing its name.
   */
  receipt(player: string, orderId: string): WorldReceipt | undefined;

  /** The instant this store's receipts reach back to. Everything at or after it
   *  that ever committed is still on file. */
  receiptFloorAt(): number;

  /**
   * HOW FAR AHEAD OF THE WALL CLOCK THIS WORLD RUNS (#216).
   *
   * "Fire due events now" moves a world's clock to the instant an event was
   * due, and the partitions that firing settled are durable at that future
   * time. The advance has to be durable with them: a host that started again
   * at the wall -- after a rule reload replaced the runtime, or after the CLI
   * was restarted -- would stamp its next command EARLIER than state already on
   * disk, and a world that checks its own monotonicity refuses that order until
   * real time catches up.
   *
   * So it lives here rather than in the host that advanced it, for the same
   * reason the roster does: it outlives every host that ever ran this world.
   */
  clockSkewMs(): number;

  /**
   * Move this world's clock forward and remember it, answering the new total.
   *
   * The ONLY way the skew changes, and it answers rather than returning void so
   * a host's cached copy comes back FROM the store instead of being computed
   * alongside it -- two additions that could disagree is exactly the drift this
   * is here to prevent.
   */
  advanceClock(byMs: number): number;

  /** Close the database. Never deletes anything -- see `resetWorldStore`. */
  close(): void;
}

/**
 * What settles and what arms alongside a checkpoint's partitions.
 *
 * The local counterpart of the Durable Object store's `alsoDelete`/`alsoPut`,
 * and it exists for the reason those do: an event's deletion has to commit in
 * the same write as its effects, or a crash between them replays a handler onto
 * already-durable state and pays the same income twice. Conversely a command's
 * schedule requests must not become durable before the checkpoint that makes
 * their cause durable, or a rolled-back command leaves its timers behind.
 */
// Unexported for the reason `WorldSeatRecord` is: a caller passes an object
// literal and it is checked structurally.
interface WorldCheckpointExtras {
  /** Event ids to delete: the ones this drain ran to completion. */
  readonly settle?: readonly string[];
  /** Events to insert or replace, including a recurrence's own re-arm. */
  readonly schedule?: readonly PlannedEvent[];
  /**
   * THE RECEIPT FOR THE ORDER THIS CHECKPOINT IS THE EFFECTS OF (#195).
   *
   * In the same transaction for the same reason a settled event is: "the world
   * changed" and "this order changed it" have to become true together, or a
   * crash between them leaves an order whose effects are durable and whose
   * receipt is not -- and the page's retry then pays for it twice.
   */
  readonly receipt?: WorldReceipt;
  /**
   * SWEEP EVERY RECEIPT OLDER THAN THIS, and remember having done so.
   *
   * Passed by the host, which owns the clock and the retention budget. The
   * remembered floor is what lets a later repeat with no receipt be told
   * honestly that nothing can say what became of it.
   */
  readonly receiptFloorAt?: number;
  /**
   * THIS SEAT WAS HERE, AND THE WORLD ACCEPTED WHAT THEY DID (#383).
   *
   * In the same transaction as the effects, for the reason the receipt is:
   * "the world changed" and "this player is the one who changed it" have to
   * become true together. A watermark moved outside the checkpoint would keep
   * a seat alive on the strength of a command that was rolled back -- and,
   * worse, moved BEFORE it would let any client hold an empire open by sending
   * refusable garbage on a timer, which is an inactivity deadline that nothing
   * can ever reach.
   *
   * Absent on the roads that are not a seat acting: a drained event, a
   * presence hook, a migration.
   */
  readonly activity?: { readonly seat: number; readonly at: number };
}

/**
 * Open (creating if needed) the world store for a database file.
 *
 * BUDGETS ARE PASSED, never read from a default. `worldBudgets()` is the
 * library's answer and a host may override it; a store that read the numbers
 * for itself would be a second place a laptop and the platform could silently
 * disagree about how large a partition may be, which is exactly what #165 moved
 * the budgets into the library to prevent.
 */
export function openWorldStore(path: string, budgets: WorldBudgets): LocalWorldStore {
  mkdirSync(dirname(path), { recursive: true });
  const db = new (loadSqlite().DatabaseSync)(path);
  let closed = false;

  // WAL, because a dev host writes small and often and a rollback journal
  // rewrites the whole page set for each of them. FULL rather than WAL's usual
  // NORMAL: NORMAL lets the last few commits live in the OS page cache, which
  // survives this process dying but not the machine doing so -- and "close the
  // laptop and open it again" is the acceptance sentence for this store.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec(SCHEMA);
  assertSchemaVersion(db, path);

  const stmt = {
    readPartition: db.prepare('SELECT parent_id, json FROM partitions WHERE name = ?'),
    writePartition: db.prepare(
      'INSERT INTO partitions (name, parent_id, json) VALUES (?, ?, ?) ' +
        'ON CONFLICT(name) DO UPDATE SET json = excluded.json',
    ),
    knownParent: db.prepare('SELECT parent_id FROM partitions WHERE name = ?'),
    listDirty: db.prepare('SELECT name FROM dirty ORDER BY name'),
    listPartitions: db.prepare('SELECT name FROM partitions ORDER BY name'),
    readReceipt: db.prepare(
      'SELECT player, order_id, at, message FROM receipts WHERE player = ? AND order_id = ?',
    ),
    writeReceipt: db.prepare(
      'INSERT INTO receipts (player, order_id, at, message) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(player, order_id) DO NOTHING',
    ),
    sweepReceipts: db.prepare('DELETE FROM receipts WHERE at < ?'),
    addDirty: db.prepare('INSERT INTO dirty (name) VALUES (?) ON CONFLICT(name) DO NOTHING'),
    clearDirty: db.prepare('DELETE FROM dirty WHERE name = ?'),
    listEvents: db.prepare(
      'SELECT id, due, seq, key, owner, action, args, every_ms, attempts ' +
        'FROM scheduled ORDER BY due, seq',
    ),
    writeEvent: db.prepare(
      'INSERT INTO scheduled (id, due, seq, key, owner, action, args, every_ms, attempts) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET due = excluded.due, seq = excluded.seq, key = excluded.key, ' +
        'owner = excluded.owner, action = excluded.action, args = excluded.args, ' +
        'every_ms = excluded.every_ms, attempts = excluded.attempts',
    ),
    deleteEvent: db.prepare('DELETE FROM scheduled WHERE id = ?'),
    listSeats: db.prepare('SELECT player, seat FROM seats ORDER BY seat'),
    readActivity: db.prepare('SELECT at FROM seat_activity WHERE seat = ?'),
    // A HIGH-WATER MARK IN SQL, not in a read-then-write the host could race or
    // get backwards: a drained event runs at its nominal due, which is in the
    // past, and replaying one must never age a player who is here now.
    writeActivity: db.prepare(
      'INSERT INTO seat_activity (seat, at) VALUES (?, ?) ' +
        'ON CONFLICT(seat) DO UPDATE SET at = max(at, excluded.at)',
    ),
    writeSeat: db.prepare(
      'INSERT INTO seats (player, seat) VALUES (?, ?) ON CONFLICT(player) DO UPDATE SET seat = excluded.seat',
    ),
    readMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    writeMeta: db.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ),
  };

  function meta(key: string): string | undefined {
    const row = stmt.readMeta.get(key) as { value: string } | undefined;
    return row?.value;
  }

  /**
   * Run `body` as one transaction.
   *
   * `IMMEDIATE` so the write lock is taken at `BEGIN` rather than at the first
   * write: a deferred transaction that meets a busy database halfway through
   * cannot upgrade and fails after some of its statements have run, which is
   * the torn checkpoint wearing a different hat.
   */
  function transact(body: () => void): void {
    db.exec('BEGIN IMMEDIATE');
    try {
      body();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    path,

    async read(name: string): Promise<StoredPartition | undefined> {
      assertStorablePartitionName(name);
      const row = stmt.readPartition.get(name) as { parent_id: number; json: string } | undefined;
      if (!row) return undefined;
      return { parentId: row.parent_id, json: JSON.parse(row.json) as unknown };
    },

    /**
     * Mint an ENTIRE GENESIS, or none of it.
     *
     * Every name and every size is checked BEFORE the transaction opens, so a
     * genesis refused for one bad partition name writes nothing at all -- and
     * the launched flag most of all. A world marked launched with nothing in it
     * is wedged forever: every command re-runs genesis, meets a world that has
     * already launched, and refuses for a missing partition whose absence
     * nothing explains.
     */
    createOne(name: string, built: WorldCreatedPartition): void {
      // ALREADY THERE IS ALREADY DONE. Two declarations can reach for the same
      // absent root; the first writes it and the second must find that one
      // rather than replacing it with a fresh empty element.
      if (stmt.knownParent.get(name) !== undefined) return;
      assertStorablePartitionName(name);
      const json = JSON.stringify(built.partition.json);
      assertPartitionWithinBudget(name, json, budgets);
      transact(() => {
        stmt.writePartition.run(name, built.partition.parentId, json);
        // THE STAMP WITH THE BYTES IT WAS MINTED FOR (#377). A root written
        // without it is a root the next host would mint over.
        stmt.writeMeta.run(NEXT_ELEMENT_ID_KEY, String(built.nextElementId));
      });
    },

    async createAll(genesis: WorldGenesis, stateVersion = 0): Promise<void> {
      const rows = Object.entries(genesis.partitions).map(([name, record]) => {
        assertStorablePartitionName(name);
        const json = JSON.stringify(record.json);
        assertPartitionWithinBudget(name, json, budgets);
        return { name, parentId: record.parentId, json };
      });
      transact(() => {
        for (const row of rows) stmt.writePartition.run(row.name, row.parentId, row.json);
        // THE VERSION GENESIS WROTE THESE BYTES UNDER (#200), with the bytes.
        // A world born on stateVersion 2 that recorded 0 would be asked, on its
        // very next start, to migrate from a version it was never written in.
        stmt.writeMeta.run(STATE_VERSION_KEY, String(stateVersion));
        // AND THE ALLOCATION GENESIS LEFT BEHIND (#377), for the same reason
        // and in the same transaction.
        stmt.writeMeta.run(NEXT_ELEMENT_ID_KEY, String(genesis.nextElementId));
        stmt.writeMeta.run(LAUNCHED_KEY, '1');
      });
    },

    /**
     * ONE TRANSACTION: the partitions, the dirty set and the schedule.
     *
     * This is the whole reason the store is SQLite. A checkpoint that landed a
     * prefix of the dirty set leaves rooms disagreeing about which command last
     * ran; one that cleared the dirty set without writing the bytes claims
     * durability for state that is gone; one that settled an event without its
     * effects pays it twice on the next drain. Each of those is a corruption
     * nothing downstream can detect, so all three commit together or not at
     * all.
     *
     * A checkpoint naming a partition this store has neither read nor created
     * is REFUSED, because the store does not know where the subtree hangs, and
     * writing it under a guessed parent would graft it into the wrong place on
     * the next wake. That refusal, like every size and name check, runs before
     * the transaction opens.
     */
    async writeCheckpoint(
      checkpoint: WorldSerialized,
      extras: WorldCheckpointExtras = {},
    ): Promise<void> {
      const rows = Object.entries(checkpoint.partitions).map(([name, json]) => {
        assertStorablePartitionName(name);
        assertPartitionWithinBudget(name, json, budgets);
        const known = stmt.knownParent.get(name) as { parent_id: number } | undefined;
        if (!known) throw unknownPartition(name);
        return { name, parentId: known.parent_id, json };
      });
      const schedule = extras.schedule ?? [];
      const settle = extras.settle ?? [];
      const highestSeq = schedule.reduce((high, event) => Math.max(high, event.seq), -1);

      transact(() => {
        writePartitions(rows);
        // THE STAMP LANDS WITH THE BYTES IT MINTED (#224). A command that
        // created an element moved this counter; a restart built from the older
        // number would be refused by the very partitions this write is storing.
        stmt.writeMeta.run(NEXT_ELEMENT_ID_KEY, String(checkpoint.nextElementId));
        // SETTLED BEFORE ARMED, so a recurrence that re-arms under the id it
        // just ran is not deleted by its own settlement.
        for (const id of settle) stmt.deleteEvent.run(id);
        writeEvents(schedule);
        // The sequence advances with the events that used it, never beside
        // them: a counter that outran a rolled-back checkpoint would leave a
        // hole in an ordering whose only job is to break ties the same way
        // twice.
        if (highestSeq >= 0) {
          stmt.writeMeta.run(SEQ_KEY, String(Math.max(readSeq(), highestSeq + 1)));
        }
        writeLedger(extras);
      });
    },

    isLaunched(): boolean {
      return meta(LAUNCHED_KEY) === '1';
    },

    dirtyPartitions(): readonly string[] {
      return (stmt.listDirty.all() as Array<{ name: string }>).map((row) => row.name);
    },

    recordDirty(names: readonly string[]): void {
      transact(() => {
        for (const name of names) {
          assertStorablePartitionName(name);
          stmt.addDirty.run(name);
        }
      });
    },

    discardDirty(names: readonly string[]): void {
      transact(() => {
        for (const name of names) stmt.clearDirty.run(name);
      });
    },

    pendingEvents(): readonly PlannedEvent[] {
      return (stmt.listEvents.all() as EventRow[]).map((row) => ({
        id: row.id,
        due: row.due,
        seq: row.seq,
        owner: row.owner,
        action: row.action,
        args: JSON.parse(row.args) as Record<string, unknown>,
        attempts: row.attempts,
        ...(row.key === null ? {} : { key: row.key }),
        ...(row.every_ms === null ? {} : { everyMs: row.every_ms }),
      }));
    },

    nextSeq(): number {
      return readSeq();
    },

    seats(): readonly WorldSeatRecord[] {
      return stmt.listSeats.all() as WorldSeatRecord[];
    },

    seat(player: string, seat: number): void {
      stmt.writeSeat.run(player, seat);
    },

    activitySince(openedAt: number): number {
      const stored = meta(ACTIVITY_SINCE_KEY);
      if (stored !== undefined) return Number(stored);
      transact(() => {
        stmt.writeMeta.run(ACTIVITY_SINCE_KEY, String(openedAt));
      });
      return openedAt;
    },

    activityOf(seat: number): SeatActivityStamp {
      const row = stmt.readActivity.get(seat) as { at: number } | undefined;
      return {
        seat,
        // NULL IS THE ANSWER for a seat this world has not seen act since it
        // began recording, and it is a different answer from `since`. The
        // engine applies the fallback once, so no caller here has to choose.
        at: row === undefined ? null : row.at,
        since: recordingSince(),
      };
    },

    receipt(player: string, orderId: string): WorldReceipt | undefined {
      const row = stmt.readReceipt.get(player, orderId) as ReceiptRow | undefined;
      if (row === undefined) return undefined;
      return {
        orderId: row.order_id,
        player: row.player,
        at: row.at,
        ...(row.message === null ? {} : { message: row.message }),
      };
    },

    receiptFloorAt(): number {
      return readReceiptFloor();
    },

    clockSkewMs(): number {
      return readClockSkew();
    },

    advanceClock(byMs: number): number {
      if (!Number.isFinite(byMs) || byMs < 0) {
        throw new Error(
          `A world's clock only ever moves forward, so it cannot be advanced by ${byMs}ms.`,
        );
      }
      const total = readClockSkew() + byMs;
      transact(() => {
        stmt.writeMeta.run(CLOCK_SKEW_KEY, String(total));
      });
      return total;
    },

    partitionNames(): readonly string[] {
      return (stmt.listPartitions.all() as Array<{ name: string }>).map((row) => row.name);
    },

    stateVersion(): number {
      const stored = meta(STATE_VERSION_KEY);
      return stored === undefined ? 0 : Number(stored);
    },

    recordAllocation(nextElementId: number): void {
      transact(() => {
        stmt.writeMeta.run(NEXT_ELEMENT_ID_KEY, String(nextElementId));
      });
    },

    nextElementId(): number | undefined {
      const stored = meta(NEXT_ELEMENT_ID_KEY);
      // UNDEFINED IS AN ANSWER (#377), and it is the one a world written before
      // the stamp existed gives. The host repairs it from the stored bytes
      // once, rather than this file inventing a number it cannot know.
      return stored === undefined ? undefined : Number(stored);
    },

    rekey({ partitions, events, nextElementId }): void {
      const rows = Object.entries(partitions).map(([name, json]) => {
        const known = stmt.knownParent.get(name) as { parent_id: number } | undefined;
        if (!known) throw unknownPartition(name);
        return { name, parentId: known.parent_id, json };
      });
      transact(() => {
        writePartitions(rows);
        writeEvents(events);
        // THE STAMP MOVES WITH THE IDS (#377). A lift shifts every id in the
        // world; a stamp left where it was would sit below them and hand the
        // next mint an identity a lifted root already holds.
        stmt.writeMeta.run(NEXT_ELEMENT_ID_KEY, String(nextElementId));
      });
    },

    migrate({ partitions, created, events, toStateVersion }): void {
      const rows = Object.entries(partitions).map(([name, json]) => {
        const known = stmt.knownParent.get(name) as { parent_id: number } | undefined;
        if (!known) throw unknownPartition(name);
        return { name, parentId: known.parent_id, json };
      });
      // NEW ROOTS CARRY THEIR OWN PARENT, because there is no row to read one
      // from -- and they are checked here, before the transaction opens, for
      // the reason `createAll` checks its own: a migration refused halfway is
      // the one failure this whole method exists to make impossible.
      for (const [name, record] of Object.entries(created.created)) {
        assertStorablePartitionName(name);
        const json = JSON.stringify(record.json);
        assertPartitionWithinBudget(name, json, budgets);
        rows.push({ name, parentId: record.parentId, json });
      }
      transact(() => {
        writePartitions(rows);
        writeEvents(events);
        // THE ALLOCATION THE MIGRATION'S NEW ROOTS WERE MINTED FROM (#377).
        stmt.writeMeta.run(NEXT_ELEMENT_ID_KEY, String(created.nextElementId));
        // LAST, and inside the same transaction: the version is the claim that
        // everything above is written, so it must not become true before they
        // are.
        stmt.writeMeta.run(STATE_VERSION_KEY, String(toStateVersion));
      });
    },

    close(): void {
      // CLOSING TWICE IS CLOSING ONCE (#197). Shutdown runs from a signal
      // handler, and a signal can arrive twice.
      if (closed) return;
      closed = true;
      db.close();
    },
  };

  /**
   * THE ORDER LEDGER'S SHARE OF ONE CHECKPOINT (#195).
   *
   * Inside the same transaction as the partitions, because "the world changed"
   * and "this order changed it" have to become true together -- a refused
   * checkpoint writes no receipt, which is exactly right: an order that changed
   * nothing has nothing to replay. The sweep and the remembered floor move
   * together for the same reason, so the floor is never a claim about receipts
   * that are still on file.
   */
  /**
   * The recording epoch, or a loud failure (#383).
   *
   * NO ZERO DEFAULT. Falling back to the epoch here is the precise bug
   * `activitySince` exists to prevent -- every seat reads as fifty-six years
   * idle and the cleanup deadline that notices is irreversible -- so a store
   * asked about activity before its epoch was fixed says so instead.
   */
  function recordingSince(): number {
    const stored = meta(ACTIVITY_SINCE_KEY);
    if (stored === undefined) {
      throw new Error(
        'This world was asked for a seat\'s activity before it recorded when it started ' +
          'watching, so the only idleness it could report would be "since 1970" -- which is ' +
          'how every seat in an upgraded world gets reaped at once. Call activitySince() when ' +
          'the world is opened, before any command runs.',
      );
    }
    return Number(stored);
  }

  function writeLedger(extras: WorldCheckpointExtras): void {
    if (extras.receipt !== undefined) {
      const { player, orderId, at, message } = extras.receipt;
      stmt.writeReceipt.run(player, orderId, at, message ?? null);
    }
    if (extras.receiptFloorAt !== undefined && extras.receiptFloorAt > readReceiptFloor()) {
      stmt.sweepReceipts.run(extras.receiptFloorAt);
      stmt.writeMeta.run(RECEIPT_FLOOR_KEY, String(extras.receiptFloorAt));
    }
    if (extras.activity !== undefined) {
      stmt.writeActivity.run(extras.activity.seat, extras.activity.at);
    }
  }

  /** The partition rows of a write, and the dirty marks they satisfy. Shared by
   *  the checkpoint and the migration, which write the same rows for different
   *  reasons. */
  function writePartitions(
    rows: readonly { name: string; parentId: number; json: string }[],
  ): void {
    for (const row of rows) {
      stmt.writePartition.run(row.name, row.parentId, row.json);
      stmt.clearDirty.run(row.name);
    }
  }

  /** The event rows of a write. Insert-or-replace, so an event re-armed under
   *  its own id and one whose arguments a migration rewrote take the same path. */
  function writeEvents(events: readonly PlannedEvent[]): void {
    for (const event of events) {
      stmt.writeEvent.run(
        event.id,
        event.due,
        event.seq,
        event.key ?? null,
        event.owner,
        event.action,
        JSON.stringify(event.args),
        event.everyMs ?? null,
        event.attempts,
      );
    }
  }

  function readReceiptFloor(): number {
    const stored = meta(RECEIPT_FLOOR_KEY);
    return stored === undefined ? 0 : Number(stored);
  }

  function readClockSkew(): number {
    const stored = meta(CLOCK_SKEW_KEY);
    return stored === undefined ? 0 : Number(stored);
  }

  function readSeq(): number {
    const stored = meta(SEQ_KEY);
    return stored === undefined ? 0 : Number(stored);
  }
}

/** One receipt as SQLite hands it back. */
interface ReceiptRow {
  player: string;
  order_id: string;
  at: number;
  message: string | null;
}

/** One scheduled event as SQLite hands it back. */
interface EventRow {
  id: string;
  due: number;
  seq: number;
  key: string | null;
  owner: string;
  action: string;
  args: string;
  every_ms: number | null;
  attempts: number;
}

const LAUNCHED_KEY = 'launched';
const SEQ_KEY = 'seq';
const RECEIPT_FLOOR_KEY = 'receiptFloor';
const CLOCK_SKEW_KEY = 'clockSkew';
const STATE_VERSION_KEY = 'stateVersion';
/**
 * THE WORLD'S DURABLE ID ALLOCATION (ShufflewickPub #377).
 *
 * The next element id the world may mint. It lives in meta rather than being
 * derived from the partitions because deriving it means reading all of them,
 * and reading all of them is the cost partitioning exists to avoid. Written in
 * the SAME transaction as every write that minted ids, so a store holding a new
 * root and a stale stamp is not a state this file can produce.
 */
const NEXT_ELEMENT_ID_KEY = 'nextElementId';
/**
 * WHEN THIS WORLD BEGAN RECORDING PER-SEAT ACTIVITY (ShufflewickPub #383).
 *
 * Written once, on the first open under a BoardSmith that has the field, and
 * never moved again. It is the floor every seat's idleness is measured from,
 * which is what makes an OCCUPIED world safe to upgrade: a store with no
 * per-seat history cannot invent one, and the alternative default -- zero --
 * would make every existing empire fifty-six years idle at the exact moment
 * the self-destruct feature became available to notice.
 *
 * It must not drift forward on later opens either. An epoch that reset with
 * each restart would reset everybody's idleness on every deploy, and a
 * deadline nothing can reach is the same bug wearing the opposite sign.
 */
const ACTIVITY_SINCE_KEY = 'activitySince';
const SCHEMA_VERSION_KEY = 'schemaVersion';

/**
 * The layout this file owns.
 *
 * ONE ROW PER PARTITION, and that IS the cost argument rather than a tidiness
 * preference. A world could be one big value; it must not be, because reading a
 * room would then cost the whole world and a checkpoint would rewrite every
 * byte of it because one player moved a chair. A primary key on `name` makes a
 * partition a point read and a checkpoint a write of exactly the dirty set,
 * which is the same property `WORLD_PARTITION_PREFIX` buys on the platform.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS partitions (
  name TEXT PRIMARY KEY,
  parent_id INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dirty (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS scheduled (
  id TEXT PRIMARY KEY,
  due INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  key TEXT,
  owner TEXT NOT NULL,
  action TEXT NOT NULL,
  args TEXT NOT NULL,
  every_ms INTEGER,
  attempts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scheduled_due ON scheduled (due, seq);
CREATE TABLE IF NOT EXISTS seats (player TEXT PRIMARY KEY, seat INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS seat_activity (
  seat INTEGER PRIMARY KEY,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS receipts (
  player TEXT NOT NULL,
  order_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  message TEXT,
  PRIMARY KEY (player, order_id)
);
CREATE INDEX IF NOT EXISTS receipts_at ON receipts (at);
`;

/**
 * What this file's layout is called, so a store written by a different one is
 * refused rather than half-read.
 *
 * There is no migration and there must not be one yet: a local dev store holds
 * a world one author is playing, and `boardsmith dev --reset` is the honest
 * answer to a layout change. Silently reading a store this code does not
 * understand is how an author loses a world without being told.
 */
const SCHEMA_VERSION = '4';

function assertSchemaVersion(db: SqliteDatabase, path: string): void {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(SCHEMA_VERSION_KEY) as
    | { value: string }
    | undefined;
  if (row === undefined) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
    return;
  }
  if (row.value === SCHEMA_VERSION) return;
  throw new Error(
    `The local world store at ${path} was written by BoardSmith's world store layout ` +
      `${row.value}, and this BoardSmith reads layout ${SCHEMA_VERSION}. There is no migration ` +
      `for a local dev world: run \`boardsmith dev --reset\` to start this world again from ` +
      `genesis, or move the directory aside if you want to keep it.`,
  );
}

function unknownPartition(name: string): Error {
  const error = new Error(
    `The checkpoint named partition ${JSON.stringify(name)}, which this store has neither read ` +
      `nor created, so it does not know where the subtree hangs. Something reached the world tree ` +
      `without going through the partition store, and writing it under a guessed parent would ` +
      `graft it into the wrong place on the next wake.`,
  );
  error.name = 'checkpoint-unknown-partition';
  return error;
}

/** The little of `node:sqlite` this file uses, named so nothing here depends on
 *  the shape of a module the Node types may or may not describe. */
interface SqliteStatement {
  run(...params: Array<string | number | null>): unknown;
  get(...params: Array<string | number | null>): unknown;
  all(...params: Array<string | number | null>): unknown[];
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}
interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDatabase;
}

/**
 * `node:sqlite`, with the Node floor checked first and its experimental
 * warning answered rather than dumped on an author.
 *
 * ## FAIL FAST, NEVER DEGRADE
 *
 * There is deliberately no in-memory fallback and no file-store second best. A
 * world that quietly ran without durability would look exactly like a working
 * one right up to the restart it exists to survive, and the store's entire
 * value is the guarantee it makes at that moment. So a Node without
 * `node:sqlite` is an error naming the version and what to do about it.
 *
 * ## THE EXPERIMENTAL WARNING
 *
 * Node prints `ExperimentalWarning: SQLite is an experimental feature and might
 * change at any time` on the first import of `node:sqlite` (measured on
 * v22.21.1). Adding a `process.on('warning')` listener does NOT suppress it --
 * Node's own printer is installed alongside, not replaced.
 *
 * That line is addressed to whoever chose SQLite, and the author who typed
 * `boardsmith dev` did not: it names an internal of the tool, arrives with no
 * context, and there is no action they can take about it. So it is swallowed
 * HERE, at the one import that provokes it, by replacing `process.emitWarning`
 * for the length of that import and restoring it immediately -- exactly one
 * warning, matched by name and text, on one line of code. Every other warning
 * the process emits, including the author's own, is untouched, which is why
 * this is not `--no-warnings` and not a listener that mutes the category.
 *
 * The decision itself is not hidden: it is written here, in `engines.node`, and
 * in the getting-started page's Node requirement.
 */
function loadSqlite(): SqliteModule {
  assertNodeSupportsSqlite();
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]): void => {
    const name = typeof warning === 'string' ? String(rest[0] ?? '') : warning.name;
    const message = typeof warning === 'string' ? warning : warning.message;
    if (name === 'ExperimentalWarning' && message.includes('SQLite')) return;
    (emitWarning as (...args: unknown[]) => void)(warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return createRequire(import.meta.url)('node:sqlite') as SqliteModule;
  } finally {
    process.emitWarning = emitWarning;
  }
}

/**
 * Refuse a Node too old to hold a world, in the sentence that fixes it.
 *
 * Checked by version rather than by catching the import's own error, because
 * `ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite` tells an
 * author nothing about which Node they need.
 */
export function assertNodeSupportsSqlite(version: string = process.versions.node): void {
  if (atLeast(version, REQUIRED_NODE_VERSION)) return;
  throw new Error(
    `A persistent world needs Node ${REQUIRED_NODE_VERSION} or newer, and this is Node ${version}. ` +
      `BoardSmith keeps a world's partitions, schedule and roster in SQLite through Node's own ` +
      `\`node:sqlite\`, which arrived in ${REQUIRED_NODE_VERSION}; there is no fallback, because a ` +
      `world that ran without durable storage would look exactly like a working one until the ` +
      `restart it exists to survive. Install Node ${REQUIRED_NODE_VERSION} or newer -- ` +
      `\`nvm install 22\` if you use nvm -- and run \`boardsmith dev\` again.`,
  );
}

/** Is `version` at least `floor`? Compares the numeric release parts, so a
 *  prerelease tag on either side does not decide it. */
function atLeast(version: string, floor: string): boolean {
  const parts = (text: string): number[] =>
    text.split('-')[0].split('.').map((part) => Number(part) || 0);
  const actual = parts(version);
  const wanted = parts(floor);
  for (let index = 0; index < wanted.length; index += 1) {
    const left = actual[index] ?? 0;
    if (left !== wanted[index]) return left > wanted[index];
  }
  return true;
}
