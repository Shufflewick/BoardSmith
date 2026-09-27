import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { takeOsLock, type OsLock } from './os-lock.js';

/**
 * #441: chunk-merge locked with `mkdir` and removed the directory in a `finally`, so a killed run
 * left the lock behind for good, and the refusal named no holder. The lock is now one the kernel
 * releases when the holding process exits, however it exits, as `scripts/merge-branch.sh` does
 * (#333), and a refusal names the holder, whether it is still running, and how to check.
 */

const held: OsLock[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const lock of held.splice(0)) await lock.release();
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGKILL');
});

async function take(file: string, holder: string): Promise<OsLock | string> {
  const lock = await takeOsLock(file, holder);
  if (typeof lock !== 'string') held.push(lock);
  return lock;
}

const MODULE = resolve(import.meta.dirname, 'os-lock.ts');
const REPO = resolve(import.meta.dirname, '../../..');

/**
 * Takes the lock in a separate node process, which reports `locked` and then waits to be killed.
 * The program lives in the temp tree and locks the file beside itself, so it is handed no path.
 */
async function holdInChild(dir: string): Promise<ChildProcess> {
  const program = join(dir, 'hold.mjs');
  writeFileSync(
    program,
    `import { takeOsLock } from ${JSON.stringify(MODULE)};\n` +
      `const lock = await takeOsLock(new URL('./merge.lock', import.meta.url).pathname, 'chunk-merge of trading');\n` +
      `console.log(typeof lock === 'string' ? lock : 'locked');\n` +
      `setInterval(() => {}, 60_000);\n`,
  );
  const child = spawn(process.execPath, ['--import', 'tsx', program], { cwd: REPO, stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  const first = await new Promise<string>((done) => child.stdout!.once('data', (d: Buffer) => done(d.toString())));
  expect(first.trim()).toBe('locked');
  return child;
}

describe('takeOsLock (#441)', () => {
  it('refuses a second holder, naming the first, its pid, since when, and how to check it', async () => {
    const file = join(tempTree('bs-os-lock-'), 'merge.lock');
    expect(typeof (await take(file, 'chunk-merge of trading (branch chunk/trading)'))).not.toBe('string');

    const refused = await take(file, 'chunk-merge of quests');
    expect(typeof refused).toBe('string');
    expect(refused).toContain(`Another chunk-merge holds the merge lock: chunk-merge of trading (branch chunk/trading), pid ${process.pid}, since `);
    expect(refused).toContain(`It is still running; check it with \`ps -p ${process.pid}\`.`);
    expect(refused).toContain('Merges run one at a time. Wait for it to finish, then run chunk-merge again.');
  });

  it('is free again once released, and keeps no holder note behind', async () => {
    const file = join(tempTree('bs-os-lock-'), 'merge.lock');
    const first = await takeOsLock(file, 'chunk-merge of trading');
    if (typeof first === 'string') throw new Error(first);
    await first.release();
    expect(existsSync(`${file}.holder`)).toBe(false);
    expect(typeof (await take(file, 'chunk-merge of quests'))).not.toBe('string');
  });

  it('is released by the kernel when its holder is killed outright', async () => {
    const dir = tempTree('bs-os-lock-');
    const file = join(dir, 'merge.lock');
    const child = await holdInChild(dir);
    expect(readFileSync(`${file}.holder`, 'utf-8')).toContain(`pid: ${child.pid}`);
    expect(await take(file, 'chunk-merge of quests')).toContain(`chunk-merge of trading, pid ${child.pid}`);

    const exited = new Promise((done) => child.once('exit', done));
    child.kill('SIGKILL');
    await exited;
    // The helper holding the lock reads end-of-file when its parent dies; let it exit.
    let next = await takeOsLock(file, 'chunk-merge of quests');
    for (let tries = 0; typeof next === 'string' && tries < 100; tries++) {
      await new Promise((done) => setTimeout(done, 50));
      next = await takeOsLock(file, 'chunk-merge of quests');
    }
    expect(typeof next).not.toBe('string');
    if (typeof next !== 'string') held.push(next);
  });

  it('reports a lock whose recorded holder is dead, with the command that finds what still holds it', async () => {
    const dir = tempTree('bs-os-lock-');
    const file = join(dir, 'merge.lock');
    const dead = spawnSync('true').pid;
    expect(typeof (await take(file, 'chunk-merge of trading'))).not.toBe('string');
    writeFileSync(`${file}.holder`, `holder: chunk-merge of ghost\npid: ${dead}\nsince: earlier\n`);

    const refused = await take(file, 'chunk-merge of quests');
    expect(refused).toContain(`chunk-merge of ghost, pid ${dead}, since earlier`);
    expect(refused).toContain(`But pid ${dead} is no longer running, so the lock is held by a process it left behind.`);
    expect(refused).toContain(`Find that process with \`lsof ${file}\`, stop it, then run chunk-merge again.`);
  });
});
