/**
 * THE TWO PROPERTIES THAT NEED A REAL PROCESS TO DIE.
 *
 * Every other test of the local world store reuses a live handle, and a live
 * handle proves neither of the things the store exists for. So both tests here
 * spawn Node, drive the store from `world-store-child.mjs`, SIGKILL it -- no
 * clean shutdown, no `close()`, nothing flushed on the way out -- and then
 * REOPEN THE FILE from this process.
 *
 *   1. SURVIVAL. Partitions, pending scheduled events and the roster are where
 *      they were left. This is #166's acceptance sentence, and killing the
 *      writer is the only way to assert it: an in-memory store passes any
 *      version of this test that keeps the handle.
 *
 *   2. ATOMICITY. A checkpoint interrupted PARTWAY reopens un-torn. This is the
 *      single reason the store is SQLite rather than a directory of JSON files:
 *      a checkpoint writes the partitions, the dirty set and the schedule
 *      together, and a file store killed between two of those writes leaves
 *      rooms that disagree about which command last ran and a scheduled event
 *      that has already been paid. Nothing downstream can detect either.
 */
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { worldBudgets } from '../../world/budgets.js';
import { openWorldStore, worldStorePath } from './world-store.js';

const CHILD = join(dirname(fileURLToPath(import.meta.url)), 'world-store-child.mjs');
const BUDGETS = worldBudgets();

/**
 * How much a checkpoint writes in these tests.
 *
 * Big enough that a kill lands inside the transaction rather than before or
 * after it, and small enough that the suite stays quick. `elapsed` is measured
 * for real below rather than assumed, so a slower or faster machine kills at
 * the same FRACTION of the write.
 */
const PARTITIONS = 120_000;
const PARTITION_BYTES = 200;

/** How far into the measured write the kill lands. Far enough in that the
 *  transaction has begun and written, far enough from the end that a machine
 *  running the second pass faster than the first still lands inside it. */
const KILL_AT = 0.35;

interface ChildRun {
  readonly signal: NodeJS.Signals | null;
  readonly code: number | null;
  readonly stderr: string;
}

/**
 * Run the child, optionally killing it `killAfterMs` after it reports that the
 * checkpoint has BEGUN.
 *
 * Timed from the child's own `started` marker rather than from the spawn,
 * because most of a spawn is Node booting and `tsx` loading the store from
 * source -- time that has nothing to do with the write this kill has to land
 * inside, and that varies by machine far more than the write does.
 */
function runChild(
  mode: string,
  storePath: string,
  markers: string,
  options: { killAfterMs?: number } = {},
): Promise<ChildRun> {
  const child = spawn(
    process.execPath,
    [CHILD, mode, storePath, markers, String(PARTITIONS), String(PARTITION_BYTES)],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const timers: NodeJS.Timeout[] = [];
  if (options.killAfterMs !== undefined) {
    const watch = setInterval(() => {
      if (!existsSync(join(markers, 'started'))) return;
      clearInterval(watch);
      timers.push(setTimeout(() => child.kill('SIGKILL'), options.killAfterMs));
    }, 2);
    timers.push(watch);
  }
  return new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      for (const timer of timers) clearTimeout(timer);
      resolve({ code, signal, stderr });
    });
  });
}

function workspace(): { root: string; markers: string; store: string } {
  const root = mkdtempSync(join(tmpdir(), 'bs-world-durability-'));
  const markers = join(root, 'markers');
  mkdirSync(markers, { recursive: true });
  return { root, markers, store: worldStorePath(root) };
}

describe('a world that outlives the process that wrote it', () => {
  it('finds its partitions, its pending events and its seats after a SIGKILL and a reopen', async () => {
    const { root, markers, store: path } = workspace();
    try {
      const run = await runChild('live', path, markers);
      // The writer was KILLED, not closed: nothing ran on the way out, so
      // anything found below was durable at the moment of the last commit.
      expect(run.signal, run.stderr).toBe('SIGKILL');
      expect(existsSync(join(markers, 'committed'))).toBe(true);

      const store = openWorldStore(path, BUDGETS);
      try {
        expect(store.isLaunched()).toBe(true);
        expect(await store.read('world')).toEqual({ parentId: 0, json: { season: 1 } });
        expect(await store.read('room/lobby')).toEqual({ parentId: 1, json: { visitors: 3 } });
        expect(store.pendingEvents().map((event) => event.id)).toEqual([
          'seeded-0',
          'seeded-1',
          'seeded-2',
          'seeded-3',
          'seeded-4',
          'seeded-5',
          'seeded-6',
          'seeded-7',
          'seeded-8',
          'seeded-9',
        ]);
        expect(store.pendingEvents()[0].args).toEqual({ index: 0 });
        expect(store.seats()).toEqual([
          { player: 'player-a', seat: 1 },
          { player: 'player-b', seat: 2 },
        ]);
        // The checkpoint cleared the room it wrote and left the one it did not,
        // so a restarted host is told the truth about which bytes are stale.
        expect(store.dirtyPartitions()).toEqual(['room/unwritten']);
      } finally {
        store.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('reopens un-torn when a checkpoint is killed partway through', async () => {
    // A timed run first, so the kill below lands at a FRACTION of a real
    // write on this machine rather than at a number guessed on another one.
    const baseline = workspace();
    const interrupted = workspace();
    try {
      await runChild('seed', baseline.store, baseline.markers);
      const timed = await runChild('checkpoint', baseline.store, baseline.markers);
      expect(timed.code, timed.stderr).toBe(0);
      const elapsed = Number(readFileSync(join(baseline.markers, 'elapsed'), 'utf8'));

      await runChild('seed', interrupted.store, interrupted.markers);
      const killed = await runChild('checkpoint', interrupted.store, interrupted.markers, {
        killAfterMs: Math.max(20, Math.round(elapsed * KILL_AT)),
      });
      expect(killed.signal, killed.stderr).toBe('SIGKILL');
      // If the child had finished, this test would be asserting about a
      // completed checkpoint and would prove nothing. Stated rather than
      // tolerated: an inconclusive run must fail, not pass quietly.
      expect(existsSync(join(interrupted.markers, 'done'))).toBe(false);
      expect(existsSync(join(interrupted.markers, 'started'))).toBe(true);

      const store = openWorldStore(interrupted.store, BUDGETS);
      try {
        const versions = new Set<number>();
        for (let index = 0; index < PARTITIONS; index += 1) {
          const partition = await store.read(`room/${index}`);
          versions.add((partition?.json as { version: number }).version);
        }
        const pending = store.pendingEvents().map((event) => event.id);
        const dirty = store.dirtyPartitions();

        // ONE VERSION ACROSS EVERY ROOM. Two would be the torn world: rooms
        // disagreeing about which command last ran, which is exactly what a
        // file store killed between two writes leaves behind.
        expect(versions.size).toBe(1);
        const [version] = versions;

        if (version === 0) {
          // The transaction rolled back, so ALL THREE HALVES rolled back with
          // it: no bytes written, nothing cleared from the dirty set, and not
          // one of the five events settled or armed.
          expect(dirty).toHaveLength(PARTITIONS);
          expect(pending).toEqual([
            'seeded-0',
            'seeded-1',
            'seeded-2',
            'seeded-3',
            'seeded-4',
            'seeded-5',
            'seeded-6',
            'seeded-7',
            'seeded-8',
            'seeded-9',
          ]);
        } else {
          // The commit landed before the kill. Then all three halves landed
          // too, which is the same promise from the other side.
          expect(dirty).toHaveLength(0);
          expect(pending).toEqual([
            'seeded-5',
            'seeded-6',
            'seeded-7',
            'seeded-8',
            'seeded-9',
            'armed-0',
            'armed-1',
            'armed-2',
            'armed-3',
            'armed-4',
          ]);
        }
        // And the run has to have been the interesting one: killed at 40% of a
        // measured write, the checkpoint must not have committed.
        expect(version).toBe(0);
      } finally {
        store.close();
      }
    } finally {
      rmSync(baseline.root, { recursive: true, force: true });
      rmSync(interrupted.root, { recursive: true, force: true });
    }
  }, 120_000);
});
