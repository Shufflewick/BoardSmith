/**
 * ONE RUN PER WORLD (#881).
 *
 * Two `boardsmith dev` runs in one project used to open the same `world.db`,
 * each writing whole partitions back over the other's and both firing the same
 * scheduled events. The store now holds the database exclusively for as long as
 * it is open, so a second open is refused by name, and a holder that dies
 * releases it with nothing left to clean up.
 */
import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { worldBudgets } from '../../world/budgets.js';
import { fixtureSandbox } from '../../testing/fixture-sandbox.test-helper.js';
import { openWorldStore, resetWorldStore, takeWorldLock, worldStorePath } from './world-store.js';

const CHILD = join(dirname(fileURLToPath(import.meta.url)), 'world-store-child.test-helper.mjs');
// These tests run the child by its path; this links them to it, loading nothing (#1416).
import.meta.glob('./world-store-child.test-helper.mjs');
const BUDGETS = worldBudgets();

/** A child process holding the store at `path` open, resolved once it says so. */
function holdInChild(path: string, env: NodeJS.ProcessEnv): Promise<ChildProcess> {
  const child = spawn(process.execPath, [CHILD, 'hold', path, dirname(path)], {
    // tsx needs a worker thread and an esbuild process; node writes stay confined to the sandbox.
    env: { ...env, NODE_OPTIONS: `${env.NODE_OPTIONS} --allow-worker --allow-child-process` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  return new Promise((resolve, reject) => {
    child.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('holding')) resolve(child);
    });
    child.on('exit', (code, signal) => reject(new Error(`child exited (${code ?? signal}) before holding: ${stderr}`)));
  });
}

function exited(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => child.on('exit', () => resolve()));
}

describe('a world store is held by one run at a time', () => {
  it('refuses a second open in this process until the first closes', () => {
    const path = worldStorePath(fixtureSandbox('bs-world-lock-').root);
    const first = openWorldStore(path, BUDGETS, { port: 5173 });
    expect(() => openWorldStore(path, BUDGETS)).toThrow(
      new RegExp(`already open in another \`boardsmith dev\` \\(pid ${process.pid}, port 5173\\)`),
    );
    first.close();
    openWorldStore(path, BUDGETS).close();
  });

  it('refuses an open while another process holds it, and opens once that process is killed', async () => {
    const sandbox = fixtureSandbox('bs-world-lock-child-');
    const path = worldStorePath(sandbox.root);
    const child = await holdInChild(path, sandbox.env);
    const gone = exited(child);
    try {
      expect(() => openWorldStore(path, BUDGETS)).toThrow(`(pid ${child.pid}, port 5173)`);
      expect(() => openWorldStore(path, BUDGETS)).toThrow(/Stop that run/);
    } finally {
      child.kill('SIGKILL');
    }
    await gone;
    const store = openWorldStore(path, BUDGETS);
    expect(store.isLaunched()).toBe(false);
    store.close();
  });

  it('refuses --reset while another run holds the world, and deletes nothing (#1040)', async () => {
    const sandbox = fixtureSandbox('bs-world-lock-reset-');
    const path = worldStorePath(sandbox.root);
    const child = await holdInChild(path, sandbox.env);
    const gone = exited(child);
    try {
      expect(() => resetWorldStore(sandbox.root)).toThrow(`(pid ${child.pid}, port 5173)`);
      expect(existsSync(path)).toBe(true);
    } finally {
      child.kill('SIGKILL');
    }
    await gone;
    expect(resetWorldStore(sandbox.root)).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it('lets go of the world when it cannot record its holder (#1040)', () => {
    const path = worldStorePath(fixtureSandbox('bs-world-lock-holder-').root);
    // A directory where the holder note goes, so writing the note fails.
    mkdirSync(`${path}.holder`, { recursive: true });
    expect(() => takeWorldLock(path)).toThrow(/EISDIR/);
    rmdirSync(`${path}.holder`);
    takeWorldLock(path).release();
  });
});
