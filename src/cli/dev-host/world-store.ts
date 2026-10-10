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
 * which is the opposite of what #164 is for. The price is needing Node 22.5 or
 * newer. BoardSmith's `engines.node` floor is higher still (22.13, for ESLint 10).
 *
 * ## WHY A DIRECTORY, AND NOT UNDER `.boardsmith/`
 *
 * `.boardsmith/` is where the CLI's commands build their rules bundles, each in
 * a directory of its own that the command deletes when it ends. A store kept
 * beside those is one path mistake away from being erased by the one event it
 * has to survive, so it goes beside `boardsmith.json` instead, exactly as the
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

import type { DeclaredSeatActivityStamp, StoredPartition } from '../../world/contract.js';
import {
  EMPTY_NOTICE_BOX,
  isEmptyNoticeBox,
  type SettledNoticeBox,
  type WorldNoticeBox,
} from '../../world/notices.js';
import {
  assertPartitionWithinBudget,
  assertStorablePartitionName,
} from '../../world/partition-store.js';
import {
  secondEndingRefused,
  storablePartitionRows,
  type WorldCheckpointExtras,
  type WorldSeatRecord,
  type WorldStore,
} from '../../world/host/index.js';
import type {
  WorldCreatedPartition,
  WorldGenesis,
  WorldMigrated,
  WorldSerialized,
} from '../../world/runner.js';
import { mintWorldElementIdKey } from '../../world/definition.js';
import type { PlannedEvent } from '../../world/schedule-api.js';
import type { WorldBudgets } from '../../world/budgets.js';
import type { WorldReceipt } from '../../world/orders.js';

/**
 * The lowest Node that has `node:sqlite`.
 *
 * Named rather than spelled inside the check, because the same number is the
 * one the error message has to tell an author to install. `package.json`'s
 * `engines.node` asks for more (22.13, for ESLint 10); this constant is only
 * what the world store itself needs.
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

/**
 * A durable local world: {@link WorldStore} plus the one thing that is this
 * store's own rather than every store's -- the file it is open on.
 *
 * The rest of the interface moved into `boardsmith/world` when `ResidentWorld`
 * did: a laptop, the hosting platform and `boardsmith/testing`'s `TestWorld`
 * all drive the same core, so what durability MEANS must be declared once.
 */
export interface LocalWorldStore extends WorldStore {
  /** The database file this store is open on. */
  readonly path: string;

  /**
   * THE PRESENCE LEDGER (#339): which seats the world has been told are
   * present, and not since told they left. The platform keeps the same record
   * (ShufflewickPub `games/src/world-presence-ledger.ts`), and it is kept here
   * for the platform's reason: a rule reload or a restart builds a new host
   * over this store, and a host that forgot what the world was told announces
   * every open page as a new arrival.
   *
   * `closedAt` is when the seat's last socket went, written only for a bundle
   * with no `onDepart`, so a return can tell a flap from a genuine absence.
   * A chair the world's clock hands on leaves the ledger in the checkpoint
   * that releases it, because its next holder arrives.
   */
  presenceTold(): readonly { readonly seat: number; readonly closedAt: number | null }[];
  /** One seat's entry, or `undefined` when the world believes it absent. */
  presenceOf(seat: number): { readonly closedAt: number | null } | undefined;
  /** The world was told this seat is present. Clears any `closedAt`. */
  tellPresent(seat: number): void;
  /** The world was told this seat left. */
  untellPresent(seat: number): void;
  /** Still told present, and this is when its last socket went. */
  stampPresenceClosedAt(seat: number, closedAt: number): void;
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
  // CLOSED IF IT REFUSES TO OPEN. A store this code cannot read is a startup
  // failure the host reports and exits on, and a connection left behind holds
  // SQLite's WAL sidecars open against a database the author is about to move
  // aside or hand to a `boardsmith dev` that CAN read it.
  try {
    prepareSchema(db, path);
  } catch (error) {
    db.close();
    throw error;
  }

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
    deleteAllEvents: db.prepare('DELETE FROM scheduled'),
    listSeats: db.prepare('SELECT player, seat FROM seats ORDER BY seat'),
    // WHO HOLDS ONE CHAIR, AND SINCE WHEN (ShufflewickPub #423). A point read
    // by seat, because that is the question a declared activity read asks: five
    // hundred empires and it wants one row. `seated_at` is null for a chair
    // granted before this store recorded grants, which is exactly the case the
    // world's own recording epoch already answers.
    readSeatOf: db.prepare('SELECT player, seated_at FROM seats WHERE seat = ?'),
    readActivity: db.prepare('SELECT at FROM seat_activity WHERE seat = ?'),
    // A HIGH-WATER MARK IN SQL, not in a read-then-write the host could race or
    // get backwards: a drained event runs at its nominal due, which is in the
    // past, and replaying one must never age a player who is here now.
    writeActivity: db.prepare(
      'INSERT INTO seat_activity (seat, at) VALUES (?, ?) ' +
        'ON CONFLICT(seat) DO UPDATE SET at = max(at, excluded.at)',
    ),
    // `seated_at` IS WRITTEN ONCE AND NEVER MOVED (ShufflewickPub #423). It
    // means "when this holder took this chair", so a reconnect must leave it
    // alone: a baseline that moved forward every time somebody opened a tab
    // would reset their idleness on every reconnect, which is an inactivity
    // deadline that can never be reached. A chair that changes HANDS is a
    // different row, because the roster is keyed by player and a departing one
    // is deleted.
    writeSeat: db.prepare(
      'INSERT INTO seats (player, seat, seated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(player) DO UPDATE SET seat = excluded.seat',
    ),
    // THE CHAIR THE WORLD'S CLOCK HANDED ON (#278). BOTH KEYS, because the
    // engine resolved both and they must still agree at the instant of the
    // write: a row whose player moved chairs between the dispatch and the
    // checkpoint is not the row this release was about, and deleting it by seat
    // alone would retire whoever is sitting there now.
    deleteSeat: db.prepare('DELETE FROM seats WHERE player = ? AND seat = ?'),
    // AND THE WATERMARK GOES WITH THE HOLDER, because it measures how long the
    // person in the chair has been away. Left behind, it would report the next
    // occupant as idle since before they arrived.
    deleteSeatActivity: db.prepare('DELETE FROM seat_activity WHERE seat = ?'),
    listPresence: db.prepare('SELECT seat, closed_at FROM presence_told ORDER BY seat'),
    readPresence: db.prepare('SELECT closed_at FROM presence_told WHERE seat = ?'),
    writePresence: db.prepare(
      'INSERT INTO presence_told (seat, closed_at) VALUES (?, ?) ' +
        'ON CONFLICT(seat) DO UPDATE SET closed_at = excluded.closed_at',
    ),
    deletePresence: db.prepare('DELETE FROM presence_told WHERE seat = ?'),
    // ONE ROW PER SEAT WITH SOMETHING WAITING (ShufflewickPub #521): a point
    // read by seat, and a seat with an empty box has no row at all.
    readNoticeBox: db.prepare('SELECT box FROM notice_boxes WHERE seat = ?'),
    writeNoticeBox: db.prepare(
      'INSERT INTO notice_boxes (seat, box) VALUES (?, ?) ' +
        'ON CONFLICT(seat) DO UPDATE SET box = excluded.box',
    ),
    deleteNoticeBox: db.prepare('DELETE FROM notice_boxes WHERE seat = ?'),
    readMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    writeMeta: db.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ),
  };

  function meta(key: string): string | undefined {
    const row = stmt.readMeta.get(key) as { value: string } | undefined;
    return row?.value;
  }

  /** Every write below is one transaction on THIS store's handle. */
  function transact(body: () => void): void {
    transactOn(db, body);
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
      const rows = storablePartitionRows(genesis.partitions, budgets);
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
      const endedAt = readEndedAt();
      if (extras.endedAt !== undefined && endedAt !== undefined) throw secondEndingRefused(endedAt);
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
        // THE ENDING EMPTIES THE QUEUE IN THE SAME WRITE (#395), what this
        // checkpoint armed included: an ended world runs nothing else ever.
        if (extras.endedAt !== undefined) {
          stmt.deleteAllEvents.run();
          stmt.writeMeta.run(ENDED_AT_KEY, String(extras.endedAt));
        }
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

    seat(player: string, seat: number, seatedAt: number): void {
      stmt.writeSeat.run(player, seat, seatedAt);
    },

    presenceTold() {
      return (stmt.listPresence.all() as { seat: number; closed_at: number | null }[]).map(
        (row) => ({ seat: row.seat, closedAt: row.closed_at }),
      );
    },

    presenceOf(seat: number) {
      const row = stmt.readPresence.get(seat) as { closed_at: number | null } | undefined;
      return row === undefined ? undefined : { closedAt: row.closed_at };
    },

    tellPresent(seat: number): void {
      stmt.writePresence.run(seat, null);
    },

    untellPresent(seat: number): void {
      stmt.deletePresence.run(seat);
    },

    stampPresenceClosedAt(seat: number, closedAt: number): void {
      stmt.writePresence.run(seat, closedAt);
    },

    activitySince(openedAt: number): number {
      const stored = meta(ACTIVITY_SINCE_KEY);
      if (stored !== undefined) return Number(stored);
      transact(() => {
        stmt.writeMeta.run(ACTIVITY_SINCE_KEY, String(openedAt));
      });
      return openedAt;
    },

    activityOf(seat: number): DeclaredSeatActivityStamp {
      const row = stmt.readActivity.get(seat) as { at: number } | undefined;
      const chair = stmt.readSeatOf.get(seat) as
        | { player: string; seated_at: number | null }
        | undefined;
      return {
        seat,
        // NULL IS THE ANSWER for a seat this world has not seen act since it
        // began recording, and it is a different answer from `since`. The
        // engine applies the fallback once, so no caller here has to choose.
        at: row === undefined ? null : row.at,
        // THE LATER OF THE TWO FLOORS (#423). The world's recording epoch is
        // when idleness could first be observed at all; this chair's grant is
        // when there was anybody in it to observe. Measuring a newcomer from
        // the first would report them idle for the whole life of the world.
        since: Math.max(recordingSince(), chair?.seated_at ?? 0),
        tenancy: chair === undefined ? 'empty' : 'held',
      };
    },

    noticeBox(seat: number): WorldNoticeBox {
      const row = stmt.readNoticeBox.get(seat) as { box: string } | undefined;
      return row === undefined ? EMPTY_NOTICE_BOX : (JSON.parse(row.box) as WorldNoticeBox);
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

    endedAt(): number | undefined {
      return readEndedAt();
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

    nextElementId(): number | undefined {
      const stored = meta(NEXT_ELEMENT_ID_KEY);
      // UNDEFINED IS AN ANSWER (#377): the world's genesis has not run, and
      // genesis owns its own counter.
      return stored === undefined ? undefined : Number(stored);
    },

    elementIdKey(): string {
      const stored = meta(ELEMENT_ID_KEY_KEY);
      // Written with the layout, in the transaction that created this store,
      // so a layout-8 store without one is one no BoardSmith wrote.
      if (stored === undefined) {
        throw new Error(
          `The local world store at ${path} has no element id key, which every store this ` +
            `BoardSmith creates is given when it is created. Its world's ids cannot be read ` +
            `without it: run \`boardsmith dev --reset\` to start this world again from genesis.`,
        );
      }
      return stored;
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
      rows.push(...storablePartitionRows(created.created, budgets));
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

  /** THE NOTICE BOXES A DISPATCH CHANGED (ShufflewickPub #521), in the same
   *  transaction as its effects. An emptied box is a deleted row. */
  function writeNoticeBoxes(settled: readonly SettledNoticeBox[]): void {
    for (const { seat, box } of settled) {
      if (isEmptyNoticeBox(box)) stmt.deleteNoticeBox.run(seat);
      else stmt.writeNoticeBox.run(seat, JSON.stringify(box));
    }
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
    writeNoticeBoxes(extras.notices ?? []);
    // LAST, so a dispatch that both stamped a seat and freed it leaves the
    // chair empty rather than empty-with-a-watermark. Nothing reaches both
    // today -- the clock's road stamps no activity -- and an order between two
    // writes that could contradict each other is not a detail to leave to
    // whichever runs first.
    //
    // THE CHAIR THE WORLD'S CLOCK HANDED ON (#278) is written inside the same
    // transaction as the partitions, because the release is downstream of the
    // ground coming back: a checkpoint that refuses must leave the chair held
    // and the estate standing, which is the one pairing that would otherwise
    // hand a newcomer somebody else's castle.
    if (extras.vacate === undefined) return;
    const released = stmt.deleteSeat.run(extras.vacate.player, extras.vacate.seat) as {
      changes: number | bigint;
    };
    // THE WATERMARK FOLLOWS THE ROW AND NEVER LEADS IT. A release that matched
    // no row freed nobody, and clearing the chair's mark anyway would reset the
    // idleness of whoever is still sitting in it.
    // So does what the world was told about the chair (#339): its next holder
    // is a new player, and a new player arrives.
    if (Number(released.changes) > 0) {
      stmt.deleteSeatActivity.run(extras.vacate.seat);
      stmt.deletePresence.run(extras.vacate.seat);
      // And what the game left for the last holder is not the next one's (#521).
      stmt.deleteNoticeBox.run(extras.vacate.seat);
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

  function readEndedAt(): number | undefined {
    const stored = meta(ENDED_AT_KEY);
    return stored === undefined ? undefined : Number(stored);
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
/** WHEN THIS WORLD ENDED (#395). Absent while it is running; see `WorldStore.endedAt`. */
const ENDED_AT_KEY = 'endedAt';
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
 * THE WORLD'S ELEMENT ID KEY (#482).
 *
 * Minted once, in the transaction that creates the store, and never written
 * again: this host creates a world when it creates its store, and every id the
 * world ever stores is read back with this key. It stays on this laptop -- the
 * host reads it into the world it builds and sends it to no page.
 */
const ELEMENT_ID_KEY_KEY = 'elementIdKey';
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
CREATE TABLE IF NOT EXISTS seats (
  player TEXT PRIMARY KEY,
  seat INTEGER NOT NULL,
  seated_at INTEGER
);
CREATE TABLE IF NOT EXISTS seat_activity (
  seat INTEGER PRIMARY KEY,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS presence_told (
  seat INTEGER PRIMARY KEY,
  closed_at INTEGER
);
-- One row per seat that has notices waiting (ShufflewickPub #521); the box is
-- the JSON WorldNoticeBox, bounded by perSeat x noticeMaxBytes.
CREATE TABLE IF NOT EXISTS notice_boxes (
  seat INTEGER PRIMARY KEY,
  box TEXT NOT NULL
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
 * A LOCAL WORLD IS SOMEBODY'S SAVE, so a layout this code understands how to
 * upgrade is upgraded rather than refused (#225): `boardsmith dev --reset` is
 * an honest answer only when there is nothing else to offer, and offering it to
 * an author whose world is five hundred seats deep is offering to delete it.
 * Silently READING a store this code does not understand stays forbidden -- an
 * upgrade is a deliberate, atomic rewrite, never a hopeful reinterpretation.
 */
const SCHEMA_VERSION = '8';

/**
 * THE LAYOUTS THIS CODE CAN CARRY A WORLD FORWARD FROM, and the step each one
 * takes.
 *
 * A CHAIN AND NOT A SINGLE SOURCE LAYOUT, because a world sitting two layouts
 * back has to be able to reach the current layout: the alternative is telling
 * an author whose store is two upgrades old to reset it, which is offering to
 * delete a world five hundred seats deep. Each step is applied in order until
 * the stamp is current.
 *
 * EMPTY SINCE LAYOUT 8 (#482). Every layout before 8 holds a world whose
 * element ids are its bare creation counter, and layout 8's world reads every
 * id back with a key: no step can carry those ids forward, so those layouts
 * are refused with the reset, by name, rather than read. The next layout that
 * only adds to this one gets a step here.
 */
interface LayoutUpgrade {
  /** The stamp a store must carry for this step to be the next one. */
  readonly from: string;
  /** The stamp the store must carry once `apply` has committed. */
  readonly to: string;
  /** Rewrite the store, stamping `to` in the SAME transaction as the tables. */
  readonly apply: (db: SqliteDatabase) => void;
}

const LAYOUT_UPGRADES: readonly LayoutUpgrade[] = [];

/** The first layout whose world's element ids are keyed (#482). */
const FIRST_KEYED_LAYOUT = 8;

/**
 * Bring the store at `db` to this file's layout, or refuse it whole.
 *
 * READ THE LAYOUT BEFORE WRITING ANY OF IT. The order matters more than it
 * looks: a gate that created the current schema first and asked afterwards left
 * its new tables inside a store it then refused, so being told "no" had already
 * changed the world it was protecting.
 *
 * `upgrades` is a parameter, and this is exported, for one reason: the stamp check
 * below guards against a step that rewrites a store without moving its layout
 * stamp, and no step in {@link LAYOUT_UPGRADES} does that. A guard that cannot
 * be run is a guard nobody knows is broken, so the tests hand this the step
 * that forgets. Every caller in this file uses the real chain.
 */
export function prepareSchema(
  db: SqliteDatabase,
  path: string,
  upgrades: readonly LayoutUpgrade[] = LAYOUT_UPGRADES,
): void {
  const stored = storedLayout(db);
  if (stored === undefined) {
    // A world this open is creating. The tables and the layout stamp commit
    // together, so a process killed here leaves a file with nothing in it
    // rather than one whose tables no stamp accounts for.
    transactOn(db, () => {
      db.exec(SCHEMA);
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
        SCHEMA_VERSION_KEY,
        SCHEMA_VERSION,
      );
      // THE WORLD'S ID KEY, MINTED WHERE THE WORLD IS CREATED (#482), and in
      // the same transaction as the layout, so no store this code writes is
      // ever without one.
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
        ELEMENT_ID_KEY_KEY,
        mintWorldElementIdKey(),
      );
    });
    return;
  }
  let at = stored;
  for (;;) {
    if (at === SCHEMA_VERSION) return;
    const step = upgrades.find((one) => one.from === at);
    if (step === undefined) throw unreadableLayout(stored, path);
    step.apply(db);
    // WHAT THE STEP SAID IT WOULD LEAVE, CHECKED AGAINST WHAT IT LEFT.
    //
    // The stamp is what every later open reads the store's tables through, so
    // a step that rewrote the tables without moving it has produced a file no
    // BoardSmith writes -- and carrying on would run the same upgrade over a
    // store that has already had it, or spin here forever on a stamp that
    // never advances. Both are silent; this is not.
    const stamped = storedLayout(db);
    if (stamped !== step.to) throw upgradeLeftWrongStamp(step, stamped, path);
    at = step.to;
  }
}

/**
 * The layout stamp, or `undefined` for a database with nothing in it yet.
 *
 * Asked of `sqlite_master` rather than of `meta`, because reading `meta` is
 * itself a claim that the table exists -- and the one state that must be told
 * apart from every other here is "this file is new".
 */
function storedLayout(db: SqliteDatabase): string | undefined {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
    .get();
  if (table === undefined) return undefined;
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(SCHEMA_VERSION_KEY) as
    | { value: string }
    | undefined;
  return row?.value;
}

/**
 * An upgrade that did not leave the stamp it promised, said so that the author
 * keeps their world and we get told about it.
 *
 * Deliberately NOT recoverable here. The one thing this file will not do is
 * read a store whose tables and stamp disagree, because every later decision --
 * which columns exist, which upgrade runs next -- is taken off the stamp.
 */
function upgradeLeftWrongStamp(
  step: LayoutUpgrade,
  stamped: string | undefined,
  path: string,
): Error {
  return new Error(
    `The local world store at ${path} was upgraded from layout ${step.from} to layout ${step.to}, but it now ` +
      `reads as ${stamped === undefined ? 'carrying no layout stamp at all' : `layout ${stamped}`}. ` +
      `A store whose tables and stamp disagree is one no BoardSmith writes, so it is refused rather than read. ` +
      `This is a fault in BoardSmith's layout ${step.from} upgrade, not in your world: leave ${path} exactly as ` +
      `it is and report it at https://github.com/Shufflewick/BoardSmith/issues with this message, so the world ` +
      `can be recovered. To carry on in the meantime, move that file aside and run \`boardsmith dev\` again to ` +
      `start a world from genesis.`,
  );
}

/** A store this BoardSmith cannot read, said in the direction the author has to
 *  move: forward to a newer BoardSmith, or aside because nothing here can carry
 *  that layout's world across. */
function unreadableLayout(stored: string, path: string): Error {
  const ahead = Number(stored) > Number(SCHEMA_VERSION);
  const unkeyed = !ahead && Number(stored) < FIRST_KEYED_LAYOUT;
  return new Error(
    `The local world store at ${path} was written by BoardSmith's world store layout ` +
      `${stored}, and this BoardSmith reads layout ${SCHEMA_VERSION}. ` +
      (ahead
        ? `It was written by a newer BoardSmith than this one: update BoardSmith to open this ` +
          `world, rather than moving it backwards onto rules that would read it wrong.`
        : (unkeyed
            ? `That world's element ids are its bare creation counter, which let a seat count ` +
              `the elements created where it could not see them; this BoardSmith keys every ` +
              `world's ids with a secret kept in its store (#482), and an unkeyed world cannot ` +
              `be carried across. `
            : '') +
          `There is no upgrade from layout ${stored}: run \`boardsmith dev --reset\` to start ` +
          `this world again from genesis, or move the directory aside if you want to keep it.`),
  );
}

/**
 * Run `body` as one transaction on `db`.
 *
 * `IMMEDIATE` so the write lock is taken at `BEGIN` rather than at the first
 * write: a deferred transaction that meets a busy database halfway through
 * cannot upgrade and fails after some of its statements have run, which is
 * the torn checkpoint wearing a different hat.
 */
function transactOn(db: SqliteDatabase, body: () => void): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    body();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
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
export interface SqliteDatabase {
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
