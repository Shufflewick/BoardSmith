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

import type { StoredPartition, WorldPartitionStore } from '../../world/contract.js';
import {
  assertPartitionWithinBudget,
  assertStorablePartitionName,
  type WorldPartitionWriter,
} from '../../world/partition-store.js';
import type { PlannedEvent } from '../../world/schedule-api.js';
import type { WorldBudgets } from '../../world/budgets.js';

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
    serialized: Record<string, string>,
    extras?: WorldCheckpointExtras,
  ): Promise<void>;

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
    addDirty: db.prepare('INSERT INTO dirty (name) VALUES (?) ON CONFLICT(name) DO NOTHING'),
    clearDirty: db.prepare('DELETE FROM dirty WHERE name = ?'),
    listEvents: db.prepare(
      'SELECT id, due, seq, key, owner, command, args, every_ms, attempts ' +
        'FROM scheduled ORDER BY due, seq',
    ),
    writeEvent: db.prepare(
      'INSERT INTO scheduled (id, due, seq, key, owner, command, args, every_ms, attempts) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET due = excluded.due, seq = excluded.seq, key = excluded.key, ' +
        'owner = excluded.owner, command = excluded.command, args = excluded.args, ' +
        'every_ms = excluded.every_ms, attempts = excluded.attempts',
    ),
    deleteEvent: db.prepare('DELETE FROM scheduled WHERE id = ?'),
    listSeats: db.prepare('SELECT player, seat FROM seats ORDER BY seat'),
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
    async createAll(records: Record<string, StoredPartition>): Promise<void> {
      const rows = Object.entries(records).map(([name, record]) => {
        assertStorablePartitionName(name);
        const json = JSON.stringify(record.json);
        assertPartitionWithinBudget(name, json, budgets);
        return { name, parentId: record.parentId, json };
      });
      transact(() => {
        for (const row of rows) stmt.writePartition.run(row.name, row.parentId, row.json);
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
      serialized: Record<string, string>,
      extras: WorldCheckpointExtras = {},
    ): Promise<void> {
      const rows = Object.entries(serialized).map(([name, json]) => {
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
        for (const row of rows) {
          stmt.writePartition.run(row.name, row.parentId, row.json);
          stmt.clearDirty.run(row.name);
        }
        // SETTLED BEFORE ARMED, so a recurrence that re-arms under the id it
        // just ran is not deleted by its own settlement.
        for (const id of settle) stmt.deleteEvent.run(id);
        for (const event of schedule) {
          stmt.writeEvent.run(
            event.id,
            event.due,
            event.seq,
            event.key ?? null,
            event.owner,
            event.command,
            JSON.stringify(event.args),
            event.everyMs ?? null,
            event.attempts,
          );
        }
        // The sequence advances with the events that used it, never beside
        // them: a counter that outran a rolled-back checkpoint would leave a
        // hole in an ordering whose only job is to break ties the same way
        // twice.
        if (highestSeq >= 0) {
          stmt.writeMeta.run(SEQ_KEY, String(Math.max(readSeq(), highestSeq + 1)));
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
        command: row.command,
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

    close(): void {
      db.close();
    },
  };

  function readSeq(): number {
    const stored = meta(SEQ_KEY);
    return stored === undefined ? 0 : Number(stored);
  }
}

/** One scheduled event as SQLite hands it back. */
interface EventRow {
  id: string;
  due: number;
  seq: number;
  key: string | null;
  owner: string;
  command: string;
  args: string;
  every_ms: number | null;
  attempts: number;
}

const LAUNCHED_KEY = 'launched';
const SEQ_KEY = 'seq';
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
  command TEXT NOT NULL,
  args TEXT NOT NULL,
  every_ms INTEGER,
  attempts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scheduled_due ON scheduled (due, seq);
CREATE TABLE IF NOT EXISTS seats (player TEXT PRIMARY KEY, seat INTEGER NOT NULL);
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
const SCHEMA_VERSION = '1';

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
