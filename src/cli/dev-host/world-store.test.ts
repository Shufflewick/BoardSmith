/**
 * What the local world store promises WITHIN one process.
 *
 * The two properties that justify the store's existence -- surviving a real
 * restart, and refusing to tear when a checkpoint is interrupted -- cannot be
 * proved here, because a live handle proves neither. They live in
 * `world-store.durability.test.ts`, which kills real processes.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { worldBudgets } from '../../world/budgets.js';
import { readDistDir } from '../lib/zip.js';
import { generateGitignore } from '../lib/project-scaffold.js';
import { assertWorldProjectForReset } from '../commands/dev.js';
import type { PlannedEvent } from '../../world/schedule-api.js';
import type { WorldGenesis } from '../../world/runner.js';
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

const BUDGETS = worldBudgets();

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

describe('the local world store', () => {
  let root: string;
  let store: LocalWorldStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bs-world-store-'));
    store = openWorldStore(worldStorePath(root), BUDGETS);
  });

  afterEach(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
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
      await store.writeCheckpoint({ 'room/a': '{"n":1}' });
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

    it('rewrites a partition without re-parenting it', async () => {
      await store.writeCheckpoint({ 'room/a': '{"n":7}' });
      expect(await store.read('room/a')).toEqual({ parentId: 1, json: { n: 7 } });
    });

    it('refuses a partition the store has never seen, because it cannot know where it hangs', async () => {
      await expect(store.writeCheckpoint({ 'room/ghost': '{}' })).rejects.toThrow(
        /neither read nor created/,
      );
    });

    it('writes nothing at all when one named partition is unknown', async () => {
      await expect(
        store.writeCheckpoint({ 'room/a': '{"n":7}', 'room/ghost': '{}' }),
      ).rejects.toThrow(/neither read nor created/);
      expect(await store.read('room/a')).toEqual({ parentId: 1, json: { n: 0 } });
    });

    it('settles the events it ran and arms the ones it scheduled', async () => {
      await store.writeCheckpoint({}, { schedule: [event({ id: 'e1', due: 100, seq: 0 })] });
      await store.writeCheckpoint(
        { 'room/a': '{"n":1}' },
        { settle: ['e1'], schedule: [event({ id: 'e2', due: 200, seq: 1 })] },
      );
      expect(store.pendingEvents().map((e) => e.id)).toEqual(['e2']);
    });

    it('advances the sequence with the events that used it', async () => {
      expect(store.nextSeq()).toBe(0);
      await store.writeCheckpoint({}, { schedule: [event({ id: 'e1', seq: 4 })] });
      expect(store.nextSeq()).toBe(5);
    });

    it('leaves the sequence where it was when the checkpoint is refused', async () => {
      await store.writeCheckpoint({}, { schedule: [event({ id: 'e1', seq: 4 })] });
      await expect(
        store.writeCheckpoint({ 'room/ghost': '{}' }, { schedule: [event({ id: 'e2', seq: 9 })] }),
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
      await store.writeCheckpoint(
        { 'room/a': '{"n":1}' },
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
        store.writeCheckpoint(
          { 'room/ghost': '{}' },
          { receipt: { orderId: 'o1', player: 'seat-3', at: 500 } },
        ),
      ).rejects.toThrow();
      expect(store.receipt('seat-3', 'o1')).toBeUndefined();
    });

    it('keeps one seat out of another seat\'s ledger', async () => {
      await store.writeCheckpoint({}, { receipt: { orderId: 'o1', player: 'seat-3', at: 500 } });
      expect(store.receipt('seat-4', 'o1')).toBeUndefined();
    });

    it('keeps a receipt with no message, which is still an answer', async () => {
      await store.writeCheckpoint({}, { receipt: { orderId: 'o1', player: 'seat-3', at: 500 } });
      expect(store.receipt('seat-3', 'o1')).toEqual({ orderId: 'o1', player: 'seat-3', at: 500 });
    });

    it('survives a reopen, which is the whole point of a durable receipt', async () => {
      await store.writeCheckpoint({}, { receipt: { orderId: 'o1', player: 'seat-3', at: 500 } });
      store.close();
      store = openWorldStore(worldStorePath(root), BUDGETS);
      expect(store.receipt('seat-3', 'o1')?.orderId).toBe('o1');
    });

    it('starts with a floor of zero: a new world has swept nothing', () => {
      expect(store.receiptFloorAt()).toBe(0);
    });

    it('sweeps to the floor it is given and remembers where it swept to', async () => {
      await store.writeCheckpoint({}, { receipt: { orderId: 'old', player: 'seat-3', at: 100 } });
      await store.writeCheckpoint(
        {},
        { receipt: { orderId: 'new', player: 'seat-3', at: 900 }, receiptFloorAt: 500 },
      );
      expect(store.receipt('seat-3', 'old')).toBeUndefined();
      expect(store.receipt('seat-3', 'new')?.orderId).toBe('new');
      expect(store.receiptFloorAt()).toBe(500);
    });

    it('keeps a receipt written exactly at the floor', async () => {
      await store.writeCheckpoint({}, { receipt: { orderId: 'edge', player: 'seat-3', at: 500 } });
      await store.writeCheckpoint({}, { receiptFloorAt: 500 });
      expect(store.receipt('seat-3', 'edge')?.orderId).toBe('edge');
    });
  });

  describe('the schedule', () => {
    it('orders by (due, seq), so two events in one millisecond keep their insertion order', async () => {
      await store.writeCheckpoint(
        {},
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
      await store.writeCheckpoint({}, { schedule: [planned] });
      expect(store.pendingEvents()).toEqual([planned]);
    });

    it('leaves a one-shot with no key and no interval, rather than nulls a drain would have to read past', async () => {
      await store.writeCheckpoint({}, { schedule: [event({ id: 'once' })] });
      const [pending] = store.pendingEvents();
      expect('key' in pending).toBe(false);
      expect('everyMs' in pending).toBe(false);
    });

    it('replaces an event written again under the same id, which is how a recurrence re-arms', async () => {
      await store.writeCheckpoint({}, { schedule: [event({ id: 'tick', due: 100, everyMs: 50 })] });
      await store.writeCheckpoint({}, { schedule: [event({ id: 'tick', due: 150, everyMs: 50 })] });
      expect(store.pendingEvents()).toHaveLength(1);
      expect(store.pendingEvents()[0].due).toBe(150);
    });
  });

  describe('the roster', () => {
    it('records which player holds which seat', () => {
      store.seat('player-a', 1);
      store.seat('player-b', 2);
      expect(store.seats()).toEqual([
        { player: 'player-a', seat: 1 },
        { player: 'player-b', seat: 2 },
      ]);
    });

    it('is free to re-seat a player in the seat they already hold, which is what a reconnect looks like', () => {
      store.seat('player-a', 1);
      store.seat('player-a', 1);
      expect(store.seats()).toEqual([{ player: 'player-a', seat: 1 }]);
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
