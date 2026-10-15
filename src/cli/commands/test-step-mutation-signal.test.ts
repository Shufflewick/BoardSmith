import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { fixtureSandbox } from '../../testing/fixture-sandbox.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';
import { runDiffMutationCheck } from './test-step-mutation.js';

vi.setConfig({ testTimeout: 120_000 });

const driver = await build({
  stdin: {
    contents: `import { runDiffMutationCheck, runMutationCheck } from './test-step-mutation.ts';
import { withCommandBuildDir, withDirRemovedAfter } from '../lib/command-build-dir.ts';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const projectDir = process.cwd();
if (process.env.HOLD_GROUP) {
  const kill = process.kill;
  let notified = false;
  process.kill = function(pid, signal) {
    if (pid < 0 && signal === 0 && process.env.HOLD_GROUP === 'unreadable') {
      throw Object.assign(new Error('process group observation failed'), { code: 'EINVAL' });
    }
    if (pid < 0 && signal === 0 && !existsSync(join(projectDir, 'release'))) {
      if (!notified) { notified = true; process.send('waiting-for-group'); }
      if (process.env.HOLD_GROUP === 'EPERM') throw Object.assign(new Error('process group observation denied'), { code: 'EPERM' });
      return true;
    }
    return kill.call(process, pid, signal);
  };
}
if (process.env.CHECK_KIND === 'scopes') {
  const outer = join(projectDir, 'outer'), inner = join(outer, 'inner');
  mkdirSync(inner, { recursive: true });
  await withDirRemovedAfter(outer, () => withDirRemovedAfter(inner, async () => {
    process.send('ready');
    await new Promise(() => setInterval(() => {}, 1000));
  }, async () => {
    process.send('stopping');
    while (!existsSync(join(projectDir, 'release'))) await new Promise(resolve => setTimeout(resolve, 10));
    writeFileSync(join(projectDir, 'proof.json'), JSON.stringify([existsSync(outer), existsSync(inner)]));
  }), () => writeFileSync(join(projectDir, 'sync-stopped'), 'stopped'));
} else {
  const input = { projectDir, added: new Map([['src/rules.ts', new Set([1])]]), log: () => {} };
  const run = () => process.env.CHECK_KIND === 'chunk'
    ? runMutationCheck({ ...input, claims: [], testFiles: [{ path: 'tests/busy.test.ts',
        absPath: join(projectDir, 'tests/busy.test.ts'), source: readFileSync(join(projectDir, 'tests/busy.test.ts'), 'utf8') }] })
    : runDiffMutationCheck({ ...input, cache: { get: () => undefined, set: () => {}, save: async () => {} } });
  try {
    if (process.env.NESTED) await withCommandBuildDir(projectDir, 'verify', run);
    else await run();
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}`,
    resolveDir: import.meta.dirname,
  },
  bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false,
});

interface OwnedProcess { pid: number; ppid: number; pgid: number; state: string; command: string }

function processGroup(pgid: number): OwnedProcess[] {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,stat=,comm='], { encoding: 'utf8' })
    .trim().split('\n').map((line) => {
      const [, pid, ppid, group, state, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)!;
      return { pid: Number(pid), ppid: Number(ppid), pgid: Number(group), state, command };
    }).filter((entry) => entry.pgid === pgid);
}

function groupProbe(pgid: number): boolean | string {
  try { return process.kill(-pgid, 0); }
  catch (error) { return (error as NodeJS.ErrnoException).code ?? String(error); }
}

async function mutationProject() {
  const sandbox = fixtureSandbox('bs-mutant-signal-');
  const project = join(sandbox.root, 'project');
  await fs.mkdir(join(project, 'src'), { recursive: true });
  await fs.mkdir(join(project, 'tests'));
  await fs.symlink(INSTALLED_MODULES, join(project, 'node_modules'), 'dir');
  await fs.writeFile(join(project, 'package.json'), '{"type":"module"}');
  await fs.writeFile(join(project, 'src/rules.ts'), 'export const enabled = true;\n');
  await fs.writeFile(join(project, 'driver.mjs'), driver.outputFiles[0].text);
  await fs.writeFile(join(project, 'vitest.config.ts'), `export default { test: {
  include: ['tests/**/*.test.ts'], pool: 'forks', minWorkers: 1, maxWorkers: 1,
  testTimeout: 120000, cache: false,
} };`);
  await fs.writeFile(join(project, 'tests/busy.test.ts'), `import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { enabled } from '../src/rules';
it('holds an actual mutant worker open', async () => {
  if (process.env.CANCEL_PHASE === 'baseline' || process.env.BOARDSMITH_MUTANT) {
    writeFileSync(new URL('./worker.json', import.meta.url), JSON.stringify({
      worker: process.pid, leader: process.ppid, workDir: process.env.BOARDSMITH_MUTANT,
    }));
    await new Promise(() => setInterval(() => {}, 1000));
  }
  expect(enabled).toBe(true);
});`);
  return { sandbox, project };
}

interface WorkerRecord { worker: number; leader: number; workDir: string }

async function stopOwnedGroup(owned: WorkerRecord | undefined): Promise<void> {
  if (!owned) return;
  if (processGroup(owned.leader).length > 0) process.kill(-owned.leader, 'SIGKILL');
  await vi.waitFor(() => expect(processGroup(owned.leader)).toEqual([]), { timeout: 10_000 });
}

async function workerRecord(project: string): Promise<WorkerRecord | undefined> {
  try { return JSON.parse(await fs.readFile(join(project, 'tests/worker.json'), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
}

async function waitForWorker(project: string, child: ChildProcess, output: () => string): Promise<WorkerRecord> {
  let owned: WorkerRecord | undefined;
  while (!(owned = await workerRecord(project))) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Mutation driver exited before a worker started:\n${output()}`);
    await delay(10);
  }
  return owned;
}

describe('mutation verification cancellation (#712)', () => {
  for (const { kind, phase, signal, target, nested, holdGroup } of [
    { kind: 'diff', phase: 'mutant', signal: 'SIGINT', target: 'parent', holdGroup: false },
    { kind: 'diff', phase: 'baseline', signal: 'SIGINT', target: 'parent', holdGroup: false },
    { kind: 'diff', phase: 'mutant', signal: 'SIGTERM', target: 'parent', holdGroup: false },
    { kind: 'diff', phase: 'mutant', signal: 'SIGTERM', target: 'group', nested: true, holdGroup: false },
    { kind: 'chunk', phase: 'mutant', signal: 'SIGINT', target: 'parent', holdGroup: false },
    { kind: 'diff', phase: 'mutant', signal: 'SIGINT', target: 'parent', holdGroup: true },
    { kind: 'diff', phase: 'mutant', signal: 'SIGINT', target: 'parent', nested: true, holdGroup: 'unreadable' },
    { kind: 'diff', phase: 'mutant', signal: 'SIGINT', target: 'parent', holdGroup: 'EPERM' },
  ] as const) {
    it(`stops the ${kind} ${phase} group on ${signal} to the ${target}${nested ? ' with an outer scope' : ''}${holdGroup === 'unreadable' ? ' retaining files when group observation fails' : holdGroup ? ' after group disappearance' : ''}${holdGroup === 'EPERM' ? ' with EPERM' : ''}`, async () => {
      const { sandbox, project } = await mutationProject();
      const child = spawn(process.execPath, ['driver.mjs'], {
        cwd: project, env: {
          ...sandbox.env,
          CHECK_KIND: kind, CANCEL_PHASE: phase, NESTED: nested ? 'yes' : '',
          HOLD_GROUP: holdGroup ? String(holdGroup) : '',
          NODE_OPTIONS: sandbox.env.NODE_OPTIONS + ' --allow-child-process --allow-worker --allow-addons',
        }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: true,
      });
      let output = '';
      child.stdout!.on('data', (chunk) => { output += chunk; });
      child.stderr!.on('data', (chunk) => { output += chunk; });
      const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.on('close', (code, signal) => resolve({ code, signal }));
      });
      const groupObserved = new Promise<string>((resolve) => child.on('message', (message) => {
        if (message === 'waiting-for-group') resolve(message);
      }));
      const guard = setTimeout(() => child.kill('SIGKILL'), 90_000);
      let owned: WorkerRecord | undefined;
      try {
        owned = await waitForWorker(project, child, () => output);
        const before = processGroup(owned.leader);
        expect(before.map((entry) => entry.pid)).toEqual(expect.arrayContaining([owned.leader, owned.worker]));
        if (target === 'group') process.kill(-child.pid!, signal);
        else child.kill(signal);
        if (holdGroup && holdGroup !== 'unreadable') {
          expect(await Promise.race([groupObserved, ended]), 'parent exited before its process group disappeared: ' + output).toBe('waiting-for-group');
          expect(child.signalCode).toBeNull();
          expect(processGroup(owned.leader).map((entry) => entry.pid)).not.toContain(owned.leader);
          await fs.access(owned.workDir);
          await fs.writeFile(join(project, 'release'), 'released');
        }
        const end = await ended;
        const after = processGroup(owned.leader);
        const evidence = JSON.stringify({ parent: child.pid, signal, target, before, end, after, groupProbe: groupProbe(owned.leader) });
        expect(end, output + evidence).toEqual({ code: null, signal });
        expect(after, 'owned Vitest processes survived the interrupted parent: ' + evidence).toEqual([]);
        if (holdGroup === 'unreadable') {
          expect(output).toContain('Could not confirm that Vitest process group');
          await fs.access(owned.workDir);
          expect(await fs.readdir(join(project, '.boardsmith'))).toHaveLength(2);
        } else expect(await fs.readdir(join(project, '.boardsmith'))).toEqual([]);
      } finally {
        clearTimeout(guard);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await ended;
        await stopOwnedGroup(owned);
      }
    });
  }

  it('keeps the timeout verdict and reaps the timed-out mutant group', async () => {
    const { sandbox, project } = await mutationProject();
    for (const key of ['HOME', 'TMPDIR', 'PATH'] as const) vi.stubEnv(key, sandbox.env[key]!);
    vi.stubEnv('NODE_OPTIONS', sandbox.env.NODE_OPTIONS + ' --allow-child-process --allow-worker --allow-addons');
    vi.stubEnv('CANCEL_PHASE', 'mutant');
    const guard = setTimeout(() => vi.runAllTimers(), 90_000);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const running = runDiffMutationCheck({
      projectDir: project, added: new Map([['src/rules.ts', new Set([1])]]), log: () => {},
      cache: { get: () => undefined, set: () => {}, save: async () => {} },
    });
    let finished = false;
    void running.then(() => { finished = true; }, () => { finished = true; });
    let owned: WorkerRecord | undefined;
    try {
      while (!(owned = await workerRecord(project))) {
        if (finished) { await running; throw new Error('Mutation verification ended before the timeout fixture started.'); }
        await delay(10);
      }
      vi.advanceTimersByTime(30_000);
      expect((await running).summary).toEqual({ files: 1, mutants: 1, killed: 0, survived: 0, timedOut: 1 });
      expect(processGroup(owned.leader)).toEqual([]);
      expect(await fs.readdir(join(project, '.boardsmith'))).toEqual([]);
    } finally {
      vi.useRealTimers();
      clearTimeout(guard);
      vi.unstubAllEnvs();
      await stopOwnedGroup(owned);
      await running.catch(() => {});
    }
  });

  for (const repeat of [false, true]) {
    it(`finishes asynchronous and synchronous nested cleanup before reraising the first signal${repeat ? ' when signalled again' : ''}`, async () => {
      const sandbox = fixtureSandbox('bs-nested-stop-');
      await fs.symlink(INSTALLED_MODULES, join(sandbox.root, 'node_modules'), 'dir');
      await fs.writeFile(join(sandbox.root, 'driver.mjs'), driver.outputFiles[0].text);
      const child = spawn(process.execPath, ['driver.mjs'], {
        cwd: sandbox.root, env: { ...sandbox.env, CHECK_KIND: 'scopes' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      const ready = new Promise<string>((resolve) => child.on('message', (message) => { if (message === 'ready') resolve(message); }));
      const stopping = new Promise<string>((resolve) => child.on('message', (message) => { if (message === 'stopping') resolve(message); }));
      let output = '';
      child.stderr?.on('data', (chunk) => { output += chunk; });
      const ended = new Promise<NodeJS.Signals | null>((resolve) => child.on('close', (_code, signal) => resolve(signal)));
      const guard = setTimeout(() => child.kill('SIGKILL'), 90_000);
      try {
        expect(await Promise.race([ready, ended]), output).toBe('ready');
        child.kill('SIGINT');
        expect(await Promise.race([stopping, ended]), 'parent exited before its asynchronous cleanup: ' + output).toBe('stopping');
        if (repeat) child.kill('SIGTERM');
        await fs.writeFile(join(sandbox.root, 'release'), 'released');
        expect(await ended, output).toBe('SIGINT');
        expect(JSON.parse(await fs.readFile(join(sandbox.root, 'proof.json'), 'utf8'))).toEqual([true, true]);
        expect(await fs.readFile(join(sandbox.root, 'sync-stopped'), 'utf8')).toBe('stopped');
        await expect(fs.access(join(sandbox.root, 'outer'))).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        clearTimeout(guard);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await ended;
      }
    });
  }
});
