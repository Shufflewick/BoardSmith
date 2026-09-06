// Reached by `spawn`, never by an import, which is the whole point: static
// analysis cannot see a process boundary and this file exists to be on the far
// side of one.
// fallow-ignore-file unused-file
/**
 * A REAL PROCESS THAT DRIVES THE LOCAL WORLD STORE, for the two properties a
 * live handle cannot prove.
 *
 * `world-store.durability.test.ts` spawns this and then tears it down --
 * SIGKILL, no clean close, no `close()` -- because "kill and restart
 * `boardsmith dev` mid-world" is the acceptance sentence for the store and a
 * test that reused an open database would be asserting about memory.
 *
 * Plain `.mjs` rather than a `.ts` test helper so that spawning it is a spawn
 * of Node and nothing else; `tsx` is loaded the same way `bin/boardsmith.js`
 * loads it, so the store runs from source with no build step.
 *
 * Usage: `node world-store-child.mjs <mode> <storePath> <markerDir> [count] [bytes]`
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

await import('tsx');
const { openWorldStore } = await import('./world-store.ts');
const { worldBudgets } = await import('../../world/budgets.ts');

const [mode, storePath, markerDir, countArg, bytesArg] = process.argv.slice(2);
const count = Number(countArg ?? 0);
const bytes = Number(bytesArg ?? 0);

const store = openWorldStore(storePath, worldBudgets());
const mark = (name) => writeFileSync(join(markerDir, name), 'x');

/** One partition's bytes at a given version, padded to `bytes` so a checkpoint
 *  is a write big enough for a kill to land inside it. */
function body(index, version) {
  const pad = 'x'.repeat(Math.max(0, bytes - 40));
  return JSON.stringify({ index, version, pad });
}

const names = Array.from({ length: count }, (_, index) => `room/${index}`);

/** The events seeded before a checkpoint, and the ones it arms in their place. */
function seededEvents() {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `seeded-${index}`,
    due: 1_000 + index,
    seq: index,
    owner: 'player-a',
    action: 'tick',
    args: { index },
    attempts: 0,
  }));
}
function armedEvents() {
  return Array.from({ length: 5 }, (_, index) => ({
    id: `armed-${index}`,
    due: 9_000 + index,
    seq: 20 + index,
    owner: 'world:self',
    action: 'raid',
    args: { index },
    attempts: 0,
  }));
}

if (mode === 'live') {
  // A world played, checkpointed, and then killed with no clean shutdown --
  // exactly what closing a laptop lid on `boardsmith dev` looks like.
  await store.createAll({
    world: { parentId: 0, json: { season: 1 } },
    'room/lobby': { parentId: 1, json: { visitors: 0 } },
  });
  store.seat('player-a', 1);
  store.seat('player-b', 2);
  store.recordDirty(['room/lobby', 'room/unwritten']);
  await store.writeCheckpoint(
    { 'room/lobby': JSON.stringify({ visitors: 3 }) },
    { schedule: seededEvents() },
  );
  mark('committed');
  process.kill(process.pid, 'SIGKILL');
} else if (mode === 'seed') {
  const records = {};
  for (const [index, name] of names.entries()) {
    records[name] = { parentId: 1, json: JSON.parse(body(index, 0)) };
  }
  await store.createAll(records);
  store.recordDirty(names);
  await store.writeCheckpoint({}, { schedule: seededEvents() });
  store.close();
  mark('seeded');
} else if (mode === 'checkpoint') {
  const serialized = {};
  for (const [index, name] of names.entries()) serialized[name] = body(index, 1);
  const settle = seededEvents()
    .slice(0, 5)
    .map((planned) => planned.id);
  mark('started');
  const began = Date.now();
  await store.writeCheckpoint(serialized, { settle, schedule: armedEvents() });
  writeFileSync(join(markerDir, 'elapsed'), String(Date.now() - began));
  store.close();
  mark('done');
} else {
  throw new Error(`Unknown mode: ${mode}`);
}
