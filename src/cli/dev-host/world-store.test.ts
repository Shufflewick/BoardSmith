/**
 * What the local world store promises WITHIN one process.
 *
 * The two properties that justify the store's existence -- surviving a real
 * restart, and refusing to tear when a checkpoint is interrupted -- cannot be
 * proved here, because a live handle proves neither. They live in
 * `world-store.durability.test.ts`, which kills real processes.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { worldBudgets } from '../../world/budgets.js';
import { readDistDir } from '../lib/zip.js';
import { generateGitignore } from '../lib/project-scaffold.js';
import { assertWorldProjectForReset } from '../commands/dev.js';
import type { PlannedEvent } from '../../world/schedule-api.js';
import type { WorldGenesis, WorldSerialized } from '../../world/runner.js';
import {
  assertNodeSupportsSqlite,
  openWorldStore,
  resetWorldStore,
  worldStoreDir,
  worldStorePath,
  worldResetNotice,
  REQUIRED_NODE_VERSION,
  type LocalWorldStore,
} from './world-store.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/**
 * ONE CHECKPOINT, the shape `runner.serialize` answers (#224).
 *
 * A checkpoint is bytes AND the allocation stamp those bytes were minted under,
 * because an ordinary command that creates an element moves the same counter
 * genesis does. The tests below care about the bytes, so the stamp has a
 * default; the ones that are ABOUT the stamp pass their own.
 */
const cp = (
  partitions: Record<string, string>,
  nextElementId = 1_000_100,
): WorldSerialized => ({ partitions, nextElementId });

const BUDGETS = worldBudgets();

/** When a chair was handed out, wherever a case needs one (ShufflewickPub
 *  #423). A fixed instant, because a baseline read off the wall clock is a
 *  baseline no assertion can name. */
const SEATED_AT = 1_700_000_000_000;

function event(over: Partial<PlannedEvent> = {}): PlannedEvent {
  return {
    id: 'e1',
    due: 1_000,
    seq: 0,
    owner: 'player-a',
    action: 'tick',
    args: {},
    attempts: 0,
    ...over,
  };
}

/**
 * SQLITE DIRECTLY, which every fixture below needs and nothing else may want.
 *
 * A store written under an older layout cannot be produced through
 * `LocalWorldStore`, because `LocalWorldStore` only ever writes the current
 * one. So the older world is a real one, written through the real doors, wound
 * back through this door to exactly what the older layout held.
 */
function rawExec(path: string, ...statements: readonly string[]): void {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
    DatabaseSync: new (file: string) => {
      exec(sql: string): void;
      prepare(sql: string): { all(): unknown[] };
      close(): void;
    };
  };
  const db = new DatabaseSync(path);
  try {
    for (const statement of statements) db.exec(statement);
  } finally {
    db.close();
  }
}

function rawRows(path: string, sql: string): Record<string, unknown>[] {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
    DatabaseSync: new (file: string) => {
      prepare(sql: string): { all(): unknown[] };
      close(): void;
    };
  };
  const db = new DatabaseSync(path);
  try {
    return db.prepare(sql).all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
}

/** The layout stamp on disk, read without opening the store -- which is the
 *  only way to ask what a REFUSED open left behind. */
function layoutOf(path: string): string | undefined {
  const [row] = rawRows(path, "SELECT value FROM meta WHERE key = 'schemaVersion'");
  return row?.value as string | undefined;
}

function tablesOf(path: string): string[] {
  return rawRows(path, "SELECT name FROM sqlite_master WHERE type = 'table'").map(
    (row) => row.name as string,
  );
}

/**
 * THE SAME WORLD, AS LAYOUT 4 LEFT IT (#225, ShufflewickPub #423).
 *
 * Layout 5 added one nullable column to `seats` -- when each chair was granted
 * -- and changed nothing else, so a `seats` table without it is layout 4
 * exactly. Rebuilt rather than dropped with `ALTER`, so the rewind does not
 * depend on which SQLite the test host happens to ship.
 */
function rewindToLayout4(path: string): void {
  rawExec(
    path,
    'CREATE TABLE seats_old (player TEXT PRIMARY KEY, seat INTEGER NOT NULL)',
    'INSERT INTO seats_old (player, seat) SELECT player, seat FROM seats',
    'DROP TABLE seats',
    'ALTER TABLE seats_old RENAME TO seats',
    "UPDATE meta SET value = '4' WHERE key = 'schemaVersion'",
  );
}

/**
 * THE SAME WORLD, AS LAYOUT 3 LEFT IT (#225).
 *
 * Layout 4 added `seat_activity` and the recording epoch it is measured from
 * (`36d723d6`) and changed nothing else, so removing both -- on top of the
 * layout 4 rewind -- is layout 3 exactly.
 */
function rewindToLayout3(path: string): void {
  rewindToLayout4(path);
  rawExec(
    path,
    'DROP TABLE seat_activity',
    "DELETE FROM meta WHERE key = 'activitySince'",
    "UPDATE meta SET value = '3' WHERE key = 'schemaVersion'",
  );
}

describe('the local world store', () => {
  let root: string;
  let store: LocalWorldStore;

  beforeEach(() => {
    root = tempTree('bs-world-store-');
    store = openWorldStore(worldStorePath(root), BUDGETS);
  });

  afterEach(() => {
    store.close();
  });

  describe('where it lives', () => {
    it('is a directory beside boardsmith.json, so one ignore rule covers every file SQLite owns', () => {
      expect(worldStoreDir(root)).toBe(join(root, '.boardsmith-dev-world'));
      expect(worldStorePath(root)).toBe(join(root, '.boardsmith-dev-world', 'world.db'));
    });

    it('is not under .boardsmith/, which `boardsmith dev` deletes on shutdown', () => {
      expect(worldStoreDir(root).includes(`${join(root, '.boardsmith')}/`)).toBe(false);
    });

    it('is created on open, so the first run of a world that has never been played is not an error', () => {
      expect(existsSync(worldStorePath(root))).toBe(true);
      expect(store.isLaunched()).toBe(false);
    });
  });

  /**
   * Genesis as the runner now answers it: the partitions AND the world's id
   * allocation stamp (ShufflewickPub #377). The two travel together because a
   * store that wrote one without the other is the collision that issue records.
   */
  function born(partitions: Record<string, { parentId: number; json: unknown }>): WorldGenesis {
    return { partitions: partitions as WorldGenesis['partitions'], nextElementId: 1_000_100 };
  }

  describe('genesis', () => {
    it('writes the partitions and the launched flag together', async () => {
      await store.createAll(
        born({
          world: { parentId: 0, json: { name: 'world' } },
          'room/lobby': { parentId: 1, json: { name: 'lobby' } },
        }),
      );
      expect(store.isLaunched()).toBe(true);
      expect(await store.read('world')).toEqual({ parentId: 0, json: { name: 'world' } });
      expect(await store.read('room/lobby')).toEqual({ parentId: 1, json: { name: 'lobby' } });
    });

    it('answers undefined for a partition this world does not have', async () => {
      expect(await store.read('room/nowhere')).toBeUndefined();
    });

    it('writes NOTHING when one partition name is unstorable, launched flag included', async () => {
      // Built with `defineProperty` rather than as a literal, because
      // `{ __proto__: x }` sets the prototype instead of creating the key --
      // which is the same hazard `assertStorablePartitionName` refuses, one
      // layer earlier.
      const records: Record<string, { parentId: number; json: unknown }> = Object.create(null);
      records.world = { parentId: 0, json: { name: 'world' } };
      Object.defineProperty(records, '__proto__', {
        value: { parentId: 1, json: {} },
        enumerable: true,
      });
      await expect(store.createAll(born(records))).rejects.toThrow(/reserved by JavaScript objects/);
      expect(store.isLaunched()).toBe(false);
      expect(await store.read('world')).toBeUndefined();
    });

    it('refuses a partition over the budget it was GIVEN, not a hardcoded one', async () => {
      const small = openWorldStore(join(root, 'small', 'world.db'), worldBudgets({ partitionMaxBytes: 64 }));
      try {
        await expect(
          small.createAll(born({ world: { parentId: 0, json: { pad: 'x'.repeat(200) } } })),
        ).rejects.toThrow(/over the 64-byte limit/);
      } finally {
        small.close();
      }
    });
  });

  describe('the dirty set', () => {
    it('accumulates what commands dirtied, without duplicates', () => {
      store.recordDirty(['room/a', 'room/b']);
      store.recordDirty(['room/b', 'room/c']);
      expect(store.dirtyPartitions()).toEqual(['room/a', 'room/b', 'room/c']);
    });

    it('is cleared for exactly the partitions a checkpoint wrote', async () => {
      await store.createAll(
        born({ 'room/a': { parentId: 1, json: {} }, 'room/b': { parentId: 1, json: {} } }),
      );
      store.recordDirty(['room/a', 'room/b']);
      await store.writeCheckpoint(cp({ 'room/a': '{"n":1}' }));
      expect(store.dirtyPartitions()).toEqual(['room/b']);
    });

    it('can be discarded by a host that threw its resident world away (#167)', async () => {
      // The ONE caller: `boardsmith dev` answering a checkpoint that would not
      // land by dropping the live tree, the way the platform discards its child
      // isolate. A mark describes a live tree, so once there is no live tree the
      // mark is a partition no engine can ever serialize.
      store.recordDirty(['room/a', 'room/b']);
      store.discardDirty(['room/a']);
      expect(store.dirtyPartitions()).toEqual(['room/b']);
      store.discardDirty(store.dirtyPartitions());
      expect(store.dirtyPartitions()).toEqual([]);
    });
  });

  describe('a checkpoint', () => {
    beforeEach(async () => {
      await store.createAll(born({ 'room/a': { parentId: 1, json: { n: 0 } } }));
    });

    it('records the allocation stamp its bytes were minted under (#224)', async () => {
      // The dev host's half of #224: a command that created an element moved
      // the counter, so the checkpoint that stores those bytes must store the
      // number too, or the next `boardsmith dev` is built below its own store.
      await store.writeCheckpoint(cp({ 'room/a': '{"n":7}' }, 1_000_250));
      expect(store.nextElementId()).toBe(1_000_250);
    });

    it('leaves the stamp where it was when the checkpoint is refused', async () => {
      await store.writeCheckpoint(cp({ 'room/a': '{"n":7}' }, 1_000_250));
      await expect(store.writeCheckpoint(cp({ 'room/ghost': '{}' }, 1_000_900))).rejects.toThrow(
        /neither read nor created/,
      );
      expect(store.nextElementId()).toBe(1_000_250);
    });

    it('rewrites a partition without re-parenting it', async () => {
      await store.writeCheckpoint(cp({ 'room/a': '{"n":7}' }));
      expect(await store.read('room/a')).toEqual({ parentId: 1, json: { n: 7 } });
    });

    it('refuses a partition the store has never seen, because it cannot know where it hangs', async () => {
      await expect(store.writeCheckpoint(cp({ 'room/ghost': '{}' }))).rejects.toThrow(
        /neither read nor created/,
      );
    });

    it('writes nothing at all when one named partition is unknown', async () => {
      await expect(
        store.writeCheckpoint(cp({ 'room/a': '{"n":7}', 'room/ghost': '{}' })),
      ).rejects.toThrow(/neither read nor created/);
      expect(await store.read('room/a')).toEqual({ parentId: 1, json: { n: 0 } });
    });

    it('settles the events it ran and arms the ones it scheduled', async () => {
      await store.writeCheckpoint(cp({}), { schedule: [event({ id: 'e1', due: 100, seq: 0 })] });
      await store.writeCheckpoint(cp({ 'room/a': '{"n":1}' }),
        { settle: ['e1'], schedule: [event({ id: 'e2', due: 200, seq: 1 })] },
      );
      expect(store.pendingEvents().map((e) => e.id)).toEqual(['e2']);
    });

    it('advances the sequence with the events that used it', async () => {
      expect(store.nextSeq()).toBe(0);
      await store.writeCheckpoint(cp({}), { schedule: [event({ id: 'e1', seq: 4 })] });
      expect(store.nextSeq()).toBe(5);
    });

    it('leaves the sequence where it was when the checkpoint is refused', async () => {
      await store.writeCheckpoint(cp({}), { schedule: [event({ id: 'e1', seq: 4 })] });
      await expect(
        store.writeCheckpoint(cp({ 'room/ghost': '{}' }), { schedule: [event({ id: 'e2', seq: 9 })] }),
      ).rejects.toThrow();
      expect(store.nextSeq()).toBe(5);
      expect(store.pendingEvents().map((e) => e.id)).toEqual(['e1']);
    });
  });

  describe('the receipt ledger (#195)', () => {
    beforeEach(async () => {
      await store.createAll(born({ 'room/a': { parentId: 1, json: { n: 0 } } }));
    });

    it('writes a receipt in the same transaction as the effects it belongs to', async () => {
      await store.writeCheckpoint(cp({ 'room/a': '{"n":1}' }),
        { receipt: { orderId: 'o1', player: 'seat-3', at: 500, message: 'Colony founded.' } },
      );
      expect(store.receipt('seat-3', 'o1')).toEqual({
        orderId: 'o1',
        player: 'seat-3',
        at: 500,
        message: 'Colony founded.',
      });
    });

    it('writes no receipt when the checkpoint is refused, so an order nothing changed has none', async () => {
      await expect(
        store.writeCheckpoint(cp({ 'room/ghost': '{}' }),
          { receipt: { orderId: 'o1', player: 'seat-3', at: 500 } },
        ),
      ).rejects.toThrow();
      expect(store.receipt('seat-3', 'o1')).toBeUndefined();
    });

    it('keeps one seat out of another seat\'s ledger', async () => {
      await store.writeCheckpoint(cp({}), { receipt: { orderId: 'o1', player: 'seat-3', at: 500 } });
      expect(store.receipt('seat-4', 'o1')).toBeUndefined();
    });

    it('keeps a receipt with no message, which is still an answer', async () => {
      await store.writeCheckpoint(cp({}), { receipt: { orderId: 'o1', player: 'seat-3', at: 500 } });
      expect(store.receipt('seat-3', 'o1')).toEqual({ orderId: 'o1', player: 'seat-3', at: 500 });
    });

    it('survives a reopen, which is the whole point of a durable receipt', async () => {
      await store.writeCheckpoint(cp({}), { receipt: { orderId: 'o1', player: 'seat-3', at: 500 } });
      store.close();
      store = openWorldStore(worldStorePath(root), BUDGETS);
      expect(store.receipt('seat-3', 'o1')?.orderId).toBe('o1');
    });

    it('starts with a floor of zero: a new world has swept nothing', () => {
      expect(store.receiptFloorAt()).toBe(0);
    });

    it('sweeps to the floor it is given and remembers where it swept to', async () => {
      await store.writeCheckpoint(cp({}), { receipt: { orderId: 'old', player: 'seat-3', at: 100 } });
      await store.writeCheckpoint(cp({}),
        { receipt: { orderId: 'new', player: 'seat-3', at: 900 }, receiptFloorAt: 500 },
      );
      expect(store.receipt('seat-3', 'old')).toBeUndefined();
      expect(store.receipt('seat-3', 'new')?.orderId).toBe('new');
      expect(store.receiptFloorAt()).toBe(500);
    });

    it('keeps a receipt written exactly at the floor', async () => {
      await store.writeCheckpoint(cp({}), { receipt: { orderId: 'edge', player: 'seat-3', at: 500 } });
      await store.writeCheckpoint(cp({}), { receiptFloorAt: 500 });
      expect(store.receipt('seat-3', 'edge')?.orderId).toBe('edge');
    });
  });

  describe('the schedule', () => {
    it('orders by (due, seq), so two events in one millisecond keep their insertion order', async () => {
      await store.writeCheckpoint(cp({}),
        {
          schedule: [
            event({ id: 'late', due: 200, seq: 0 }),
            event({ id: 'second', due: 100, seq: 2 }),
            event({ id: 'first', due: 100, seq: 1 }),
          ],
        },
      );
      expect(store.pendingEvents().map((e) => e.id)).toEqual(['first', 'second', 'late']);
    });

    it('round-trips every field a planned event carries', async () => {
      const planned = event({
        id: 'raid',
        due: 5_000,
        seq: 3,
        key: 'raid:north',
        owner: 'world:self',
        action: 'raid',
        args: { target: 'north', size: 4 },
        everyMs: 60_000,
        attempts: 2,
      });
      await store.writeCheckpoint(cp({}), { schedule: [planned] });
      expect(store.pendingEvents()).toEqual([planned]);
    });

    it('leaves a one-shot with no key and no interval, rather than nulls a drain would have to read past', async () => {
      await store.writeCheckpoint(cp({}), { schedule: [event({ id: 'once' })] });
      const [pending] = store.pendingEvents();
      expect('key' in pending).toBe(false);
      expect('everyMs' in pending).toBe(false);
    });

    it('replaces an event written again under the same id, which is how a recurrence re-arms', async () => {
      await store.writeCheckpoint(cp({}), { schedule: [event({ id: 'tick', due: 100, everyMs: 50 })] });
      await store.writeCheckpoint(cp({}), { schedule: [event({ id: 'tick', due: 150, everyMs: 50 })] });
      expect(store.pendingEvents()).toHaveLength(1);
      expect(store.pendingEvents()[0].due).toBe(150);
    });
  });

  describe('the roster', () => {
    it('records which player holds which seat', () => {
      store.seat('player-a', 1, SEATED_AT);
      store.seat('player-b', 2, SEATED_AT);
      expect(store.seats()).toEqual([
        { player: 'player-a', seat: 1 },
        { player: 'player-b', seat: 2 },
      ]);
    });

    it('is free to re-seat a player in the seat they already hold, which is what a reconnect looks like', () => {
      store.seat('player-a', 1, SEATED_AT);
      store.seat('player-a', 1, SEATED_AT);
      expect(store.seats()).toEqual([{ player: 'player-a', seat: 1 }]);
    });

    /**
     * ShufflewickPub #423: WHEN THE CHAIR WAS GRANTED IS PART OF THE ROW.
     *
     * A newcomer's idleness is measured from the later of the world's recording
     * epoch and their own arrival. Without the second floor, a player who joins
     * a world that has been recording for a year reads as a year idle on their
     * first wake, and an inactivity sweep reaps an empire nobody had time to
     * build.
     */
    it('measures a newcomer from when they SAT DOWN, not from when the world began recording', () => {
      store.activitySince(SEATED_AT - 400 * 86_400_000);
      store.seat('player-a', 1, SEATED_AT);

      const stamp = store.activityOf(1);
      expect(stamp.at).toBeNull();
      expect(stamp.since).toBe(SEATED_AT);
      expect(stamp.tenancy).toBe('held');
    });

    it('answers an EMPTY chair, which is not the same as a silent one', () => {
      store.activitySince(SEATED_AT);
      store.seat('player-a', 1, SEATED_AT);

      // Seat 2 was never handed out. The numbers look exactly like seat 1's,
      // and only `tenancy` says one of them is somebody's game.
      expect(store.activityOf(2)).toEqual({
        seat: 2,
        at: null,
        since: SEATED_AT,
        tenancy: 'empty',
      });
    });
  });

  describe("the world's clock advance (#216)", () => {
    it('starts level with the wall clock', () => {
      expect(store.clockSkewMs()).toBe(0);
    });

    it('accumulates every advance and answers the running total', () => {
      expect(store.advanceClock(600_000)).toBe(600_000);
      expect(store.advanceClock(14_000)).toBe(614_000);
      expect(store.clockSkewMs()).toBe(614_000);
    });

    it('is still there for the next host to open this world', () => {
      // The point of the whole thing: a rule reload and a cold restart both
      // build a new host over this store, and neither may start the world's
      // clock behind the state a fired event already settled.
      store.advanceClock(600_000);
      store.close();
      const reopened = openWorldStore(worldStorePath(root), BUDGETS);
      expect(reopened.clockSkewMs()).toBe(600_000);
      reopened.close();
    });

    it('refuses to move a world\'s clock backwards', () => {
      expect(() => store.advanceClock(-1)).toThrow(/only ever moves forward/);
      expect(store.clockSkewMs()).toBe(0);
    });
  });

  describe("a seat's activity watermark (ShufflewickPub #383)", () => {
    it('opens a world by recording WHEN it began recording, so nobody is retroactively idle', () => {
      // The migration guarantee. A world whose store predates this feature has
      // no per-seat history, and the honest answer to "how long has seat 3 been
      // gone" is "no longer than we have been watching" -- never "since 1970",
      // which is the answer that would reap every empire on the first wake.
      const opened = store.activitySince(5_000);
      expect(opened).toBe(5_000);
      // `empty`, because nobody was ever seated in this fixture: the numbers
      // are the migration answer and the tenancy is the #423 one.
      expect(store.activityOf(3)).toEqual({
        seat: 3,
        at: null,
        since: 5_000,
        tenancy: 'empty',
      });
    });

    it('fixes the recording epoch on the FIRST open and never moves it again', () => {
      store.activitySince(5_000);
      // A later open of the same world asks with a later clock and is told the
      // original answer: an epoch that drifted forward with each restart would
      // reset everybody's idleness on every deploy, which is an inactivity
      // deadline that can never be reached.
      expect(store.activitySince(9_000_000)).toBe(5_000);
      expect(store.activityOf(3).since).toBe(5_000);
    });

    it('remembers a seat\'s last accepted arrival, per seat', () => {
      store.activitySince(5_000);
      store.writeCheckpoint(cp({}), { activity: { seat: 1, at: 10_000 } });
      store.writeCheckpoint(cp({}), { activity: { seat: 2, at: 12_000 } });

      expect(store.activityOf(1)).toEqual({
        seat: 1,
        at: 10_000,
        since: 5_000,
        tenancy: 'empty',
      });
      expect(store.activityOf(2)).toEqual({
        seat: 2,
        at: 12_000,
        since: 5_000,
        tenancy: 'empty',
      });
      // Somebody else playing is not this player playing.
      expect(store.activityOf(3).at).toBeNull();
    });

    it('never moves a watermark backwards', () => {
      // A drained event runs at its NOMINAL due, which is in the past, and the
      // host must not be able to age a live player by replaying one. The store
      // is the last line: the watermark is a high-water mark by construction.
      store.activitySince(5_000);
      store.writeCheckpoint(cp({}), { activity: { seat: 1, at: 20_000 } });
      store.writeCheckpoint(cp({}), { activity: { seat: 1, at: 9_000 } });
      expect(store.activityOf(1).at).toBe(20_000);
    });

    it('is still there for the next host to open this world', () => {
      // The whole point of it being durable: hibernation, a rules reload and a
      // cold restart all build a new host over this store, and an idleness
      // clock that restarted with the process would never reach a deadline.
      store.activitySince(5_000);
      store.writeCheckpoint(cp({}), { activity: { seat: 1, at: 10_000 } });
      store.close();

      const reopened = openWorldStore(worldStorePath(root), BUDGETS);
      expect(reopened.activitySince(90_000)).toBe(5_000);
      expect(reopened.activityOf(1)).toEqual({
        seat: 1,
        at: 10_000,
        since: 5_000,
        tenancy: 'empty',
      });
      reopened.close();
    });
  });

  /**
   * #225: A WORLD SOMEBODY IS PLAYING, WRITTEN UNDER AN OLDER LAYOUT.
   *
   * The fixture is a layout-4 store written through the real doors and then
   * wound back to exactly what layout 3 held, because layout 3 is a layout this
   * code no longer writes and a hand-built one would be a fixture asserting
   * against a shape production never produced. The whole of the difference is
   * the seat activity table and the recording epoch (`36d723d6`); every other
   * table was already what it is now.
   */
  describe('a world written under an older store layout (#225)', () => {
    /** The store as an occupied world leaves it: bytes, a dirty mark, a seated
     *  player, a queued event, a receipt, an advanced clock and both stamps. */
    async function anOccupiedWorld(): Promise<void> {
      await store.createAll(
        born({
          world: { parentId: 0, json: { name: 'world' } },
          'room/aster': { parentId: 1, json: { colony: 'Aster' } },
        }),
        2,
      );
      store.seat('player-a', 7, SEATED_AT);
      store.advanceClock(600_000);
      await store.writeCheckpoint(cp({ 'room/aster': '{"colony":"Aster","pop":9}' }, 1_000_500), {
        schedule: [event({ id: 'raid', due: 5_000, key: 'raid:north' })],
        receipt: { orderId: 'o1', player: 'player-a', at: 500, message: 'Colony founded.' },
      });
      store.recordDirty(['room/aster']);
      store.close();
    }

    /** Everything the occupied world above holds, asserted through the store's
     *  own doors, so a case only has to say WHEN it expects to find it. */
    async function expectNothingLost(reopened: LocalWorldStore): Promise<void> {
      expect(reopened.isLaunched()).toBe(true);
      expect(await reopened.read('world')).toEqual({ parentId: 0, json: { name: 'world' } });
      expect(await reopened.read('room/aster')).toEqual({
        parentId: 1,
        json: { colony: 'Aster', pop: 9 },
      });
      expect(reopened.dirtyPartitions()).toEqual(['room/aster']);
      expect(reopened.seats()).toEqual([{ player: 'player-a', seat: 7 }]);
      expect(reopened.pendingEvents()).toEqual([event({ id: 'raid', due: 5_000, key: 'raid:north' })]);
      expect(reopened.receipt('player-a', 'o1')?.message).toBe('Colony founded.');
      expect(reopened.stateVersion()).toBe(2);
      expect(reopened.nextElementId()).toBe(1_000_500);
      expect(reopened.clockSkewMs()).toBe(600_000);
      expect(reopened.partitionNames()).toEqual(['room/aster', 'world']);
    }

    it('carries layout 3 all the way to the current layout on open, losing nothing', async () => {
      // A CHAIN AND NOT ONE STEP (ShufflewickPub #423): a store two upgrades
      // old has to arrive, or the only thing left to tell an author is to reset
      // a world five hundred seats deep.
      await anOccupiedWorld();
      rewindToLayout3(worldStorePath(root));

      const reopened = openWorldStore(worldStorePath(root), BUDGETS);
      try {
        await expectNothingLost(reopened);
        expect(layoutOf(worldStorePath(root))).toBe('5');
        // The table the upgrade exists to add, in use rather than merely
        // present: an upgraded world can record activity from here on.
        reopened.activitySince(5_000);
        await reopened.writeCheckpoint(cp({}), { activity: { seat: 7, at: 10_000 } });
        expect(reopened.activityOf(7)).toEqual({
          seat: 7,
          at: 10_000,
          since: 5_000,
          // The chair was granted before this store recorded grants, so the
          // world's own epoch is the whole of its baseline -- which is exactly
          // where it was measured from before the column existed.
          tenancy: 'held',
        });
      } finally {
        reopened.close();
      }
    });

    it('upgrades layout 4 to layout 5 without inventing when a chair was granted', async () => {
      await anOccupiedWorld();
      rewindToLayout4(worldStorePath(root));

      const reopened = openWorldStore(worldStorePath(root), BUDGETS);
      try {
        await expectNothingLost(reopened);
        expect(layoutOf(worldStorePath(root))).toBe('5');
        // NOT BACKFILLED. This store does not know when a chair it already held
        // was handed out, and a guessed instant is a floor somebody's empire
        // would be measured against.
        const epoch = reopened.activitySince(1_000);
        expect(reopened.activityOf(7).since).toBe(epoch);
      } finally {
        reopened.close();
      }
    });

    it('finishes an upgrade whose table an earlier refused open already left behind', async () => {
      // The BoardSmith this issue was filed against created the new table
      // BEFORE it checked the layout, so a world that was refused once is
      // sitting on layout 3 with an empty `seat_activity` already in it. That
      // is a store this upgrade still has to be able to finish.
      await anOccupiedWorld();
      rewindToLayout3(worldStorePath(root));
      rawExec(worldStorePath(root), 'CREATE TABLE seat_activity (seat INTEGER PRIMARY KEY, at INTEGER NOT NULL)');

      const reopened = openWorldStore(worldStorePath(root), BUDGETS);
      try {
        await expectNothingLost(reopened);
        expect(layoutOf(worldStorePath(root))).toBe('5');
      } finally {
        reopened.close();
      }
    });

    it('begins the missing activity history at the first open after the upgrade, and never moves it', async () => {
      // The reading that would reap every empire in an upgraded world is
      // "idle since 1970". The epoch is fixed at the first open that can
      // record one, and a later restart is told the original answer.
      await anOccupiedWorld();
      rewindToLayout3(worldStorePath(root));

      const upgraded = openWorldStore(worldStorePath(root), BUDGETS);
      expect(upgraded.activitySince(5_000)).toBe(5_000);
      expect(upgraded.activityOf(7)).toEqual({
        seat: 7,
        at: null,
        since: 5_000,
        tenancy: 'held',
      });
      upgraded.close();

      const later = openWorldStore(worldStorePath(root), BUDGETS);
      expect(later.activitySince(9_000_000)).toBe(5_000);
      later.close();
    });

    it('rolls the whole upgrade back when it cannot finish, and lets a retry do it', async () => {
      await anOccupiedWorld();
      rewindToLayout3(worldStorePath(root));
      // An index wearing the name the new table needs. SQLite refuses the
      // CREATE, which is a mid-upgrade failure without a fake in it.
      rawExec(worldStorePath(root), 'CREATE INDEX seat_activity ON seats (seat)');

      expect(() => openWorldStore(worldStorePath(root), BUDGETS)).toThrow();
      // The layout stamp moved with the table or not at all: a store left
      // claiming layout 4 with no table is one every later open reads wrong.
      expect(layoutOf(worldStorePath(root))).toBe('3');

      rawExec(worldStorePath(root), 'DROP INDEX seat_activity');
      const retried = openWorldStore(worldStorePath(root), BUDGETS);
      try {
        await expectNothingLost(retried);
        expect(layoutOf(worldStorePath(root))).toBe('5');
      } finally {
        retried.close();
      }
    });

    it('refuses a layout it has no upgrade for, without writing anything into it', async () => {
      await anOccupiedWorld();
      rewindToLayout3(worldStorePath(root));
      rawExec(worldStorePath(root), "UPDATE meta SET value = '2' WHERE key = 'schemaVersion'");

      expect(() => openWorldStore(worldStorePath(root), BUDGETS)).toThrow(
        /layout 2, and this BoardSmith reads layout 5.*no upgrade/s,
      );
      expect(layoutOf(worldStorePath(root))).toBe('2');
      // The bug that made a refusal destructive: the schema was created before
      // the layout was read, so being told no still changed the store.
      expect(tablesOf(worldStorePath(root))).not.toContain('seat_activity');
    });

    it('refuses a store written by a NEWER BoardSmith, and says which way to move', async () => {
      store.close();
      rawExec(worldStorePath(root), "UPDATE meta SET value = '6' WHERE key = 'schemaVersion'");

      expect(() => openWorldStore(worldStorePath(root), BUDGETS)).toThrow(
        /layout 6, and this BoardSmith reads layout 5.*newer BoardSmith/s,
      );
      expect(layoutOf(worldStorePath(root))).toBe('6');
    });

    it('closes the database when it refuses to open one', async () => {
      // A leaked handle keeps SQLite's WAL sidecars alive; the last connection
      // to close is what removes them. So their absence is the observable
      // proof that a refused open did not leave a connection behind.
      await anOccupiedWorld();
      rewindToLayout3(worldStorePath(root));
      rawExec(worldStorePath(root), "UPDATE meta SET value = '2' WHERE key = 'schemaVersion'");

      expect(() => openWorldStore(worldStorePath(root), BUDGETS)).toThrow();
      expect(existsSync(`${worldStorePath(root)}-shm`)).toBe(false);
      expect(existsSync(`${worldStorePath(root)}-wal`)).toBe(false);
    });
  });

  describe('reset', () => {
    it('removes the whole store, sidecars included', () => {
      store.recordDirty(['room/a']);
      store.close();
      expect(readdirSync(worldStoreDir(root)).length).toBeGreaterThan(0);
      expect(resetWorldStore(root)).toBe(true);
      expect(existsSync(worldStoreDir(root))).toBe(false);
      // Reopened so `afterEach` has a handle to close.
      store = openWorldStore(worldStorePath(root), BUDGETS);
    });

    it('says so when there was nothing to reset', () => {
      expect(resetWorldStore(join(root, 'never-played'))).toBe(false);
    });
  });

  describe('what a publish carries', () => {
    it('never carries the store: the bundle is dist/, and the store is beside boardsmith.json', () => {
      // `publishCommand` ships exactly `readDistDir(dist)`, so this is the
      // published bundle rather than a proxy for it.
      const dist = join(root, 'dist');
      mkdirSync(join(dist, 'rules'), { recursive: true });
      mkdirSync(join(dist, 'ui'), { recursive: true });
      // A WORLD's dist, since a world is what has a store to leak: its entry is
      // ui/world.html and it carries no playerCount (#188).
      writeFileSync(
        join(dist, 'manifest.json'),
        JSON.stringify({ backend: 'world', world: { maxPlayers: 8 } }),
      );
      writeFileSync(join(dist, 'rules', 'rules.js'), 'export const rules = 1;');
      writeFileSync(join(dist, 'ui', 'world.html'), '<!doctype html>');

      store.recordDirty(['room/a']);
      const bundle = [...readDistDir(dist).keys()];
      expect(bundle.some((entry) => entry.includes('boardsmith-dev-world'))).toBe(false);
      expect(bundle.some((entry) => entry.includes('world.db'))).toBe(false);
    });

    it('is ignored by the .gitignore every scaffolded project gets', () => {
      const lines = generateGitignore()
        .split('\n')
        .map((line) => line.trim());
      expect(lines).toContain('.boardsmith-dev-world/');
      // Its table-game sibling was never ignored either, and the two dev stores
      // are the same kind of thing: one author's local playthrough, not the game.
      expect(lines).toContain('.boardsmith-dev-store.json');
    });
  });

  describe('boardsmith dev --reset', () => {
    it('says what it deleted, and says so plainly when there was nothing there', () => {
      expect(worldResetNotice(true, '/p/.boardsmith-dev-world')).toContain('deleted the local world');
      expect(worldResetNotice(true, '/p/.boardsmith-dev-world')).toContain('genesis again');
      expect(worldResetNotice(false, '/p/.boardsmith-dev-world')).toContain('nothing to delete');
    });

    it('is refused on a project that declares no world, rather than quietly doing nothing', () => {
      expect(() => assertWorldProjectForReset(true)).not.toThrow();
      expect(() => assertWorldProjectForReset(false)).toThrow(/does not declare "backend": "world"/);
    });
  });

  describe('shutting down', () => {
    it('#197: closes idempotently, because a signal can arrive twice', () => {
      const other = openWorldStore(join(root, 'twice', 'world.db'), BUDGETS);
      other.close();
      expect(() => other.close()).not.toThrow();
    });
  });

  describe('the Node floor', () => {
    it('accepts the version node:sqlite arrived in, and everything after it', () => {
      expect(() => assertNodeSupportsSqlite(REQUIRED_NODE_VERSION)).not.toThrow();
      expect(() => assertNodeSupportsSqlite('24.0.0')).not.toThrow();
      expect(() => assertNodeSupportsSqlite('22.21.1')).not.toThrow();
    });

    it('refuses an older Node by naming the version and what to do, with no degraded mode offered', () => {
      let message = '';
      try {
        assertNodeSupportsSqlite('20.11.0');
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('Node 22.5.0 or newer');
      expect(message).toContain('Node 20.11.0');
      expect(message).toContain('nvm install 22');
      expect(message).toContain('there is no fallback');
    });
  });

  it('never prints Node\'s SQLite experimental warning at an author', () => {
    // Opening a store is the one call that provokes it, and the swallow is
    // scoped to exactly that import -- so a warning raised around it still


    // reaches whoever asked for it.
    const seen: string[] = [];
    const original = process.emitWarning;
    process.emitWarning = ((warning: string | Error) => {
      seen.push(typeof warning === 'string' ? warning : warning.message);
    }) as typeof process.emitWarning;
    try {
      const other = openWorldStore(join(root, 'warning-probe', 'world.db'), BUDGETS);
      other.close();
      process.emitWarning('a warning of the author\'s own', 'ExperimentalWarning');
    } finally {
      process.emitWarning = original;
    }
    expect(seen.some((text) => text.includes('SQLite is an experimental feature'))).toBe(false);
    expect(seen).toContain('a warning of the author\'s own');
  });
});
