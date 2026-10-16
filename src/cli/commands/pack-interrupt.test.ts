/**
 * `boardsmith pack` rewrites the checkout's own `package.json` for the length of `npm pack` (#744).
 * A signal during the pack, or a second pack in the same checkout, must still leave the original.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { fixtureSandbox } from '../../testing/fixture-sandbox.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';

vi.setConfig({ testTimeout: 120_000 });

const driver = await build({
  stdin: {
    contents: `import { packAll } from './pack.ts';
const [pkgDir, outDir] = process.argv.slice(2);
try { await packAll([{ name: 'bs-fixture-held', path: pkgDir, version: '1.0.0', revision: 7 }], outDir); }
catch (error) { console.error(error.message); process.exitCode = 1; }`,
    resolveDir: import.meta.dirname,
  },
  bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false,
});

/** A git checkout whose `npm pack` stops in `prepack`, after `package.json` is rewritten, until `release` exists. */
function heldPackage() {
  const sandbox = fixtureSandbox('bs-pack-interrupt-', { tools: ['npm', 'git', 'perl'] });
  const pkgDir = join(sandbox.root, 'pkg');
  mkdirSync(pkgDir);
  const original = JSON.stringify({
    name: 'bs-fixture-held', version: '1.0.0',
    scripts: { prepack: 'touch started && while [ ! -f release ]; do sleep 0.05; done' },
  }, null, 2) + '\n';
  writeFileSync(join(pkgDir, 'package.json'), original);
  writeFileSync(join(pkgDir, 'index.js'), 'module.exports = {};\n');
  execFileSync('git', ['init', '-q'], { cwd: pkgDir });
  symlinkSync(INSTALLED_MODULES, join(sandbox.root, 'node_modules'), 'dir');
  writeFileSync(join(sandbox.root, 'driver.mjs'), driver.outputFiles[0].text);
  // npm's cache and logs default outside the sandbox, and under `npx` the environment names them.
  const env = { ...sandbox.env, npm_config_cache: join(sandbox.root, 'npm-cache'), NODE_OPTIONS: `${sandbox.env.NODE_OPTIONS} --allow-child-process` };
  const run = (out: string) => {
    const child = spawn(process.execPath, ['driver.mjs', pkgDir, join(sandbox.root, out)], { cwd: sandbox.root, env });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on('close', (code, signal) => resolve({ code, signal }));
    });
    return { child, ended, output: () => output };
  };
  return { pkgDir, original, run };
}

const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;

/** Waits until `prepack` has started, or `child` has ended. */
async function untilStartedOrEnded(pkgDir: string, child: ChildProcess): Promise<void> {
  while (!existsSync(join(pkgDir, 'started')) && running(child)) await delay(10);
}

describe('pack keeps the original package.json (#744)', () => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    it(`restores package.json when ${signal} stops the pack`, async () => {
      const { pkgDir, original, run } = heldPackage();
      const pack = run('out');
      try {
        await untilStartedOrEnded(pkgDir, pack.child);
        expect(readFileSync(join(pkgDir, 'package.json'), 'utf8'), pack.output()).not.toBe(original);
        pack.child.kill(signal);
        expect(await pack.ended, pack.output()).toEqual({ code: null, signal });
        expect(readFileSync(join(pkgDir, 'package.json'), 'utf8')).toBe(original);
      } finally {
        writeFileSync(join(pkgDir, 'release'), '');
        if (running(pack.child)) pack.child.kill('SIGKILL');
        await pack.ended;
      }
    });
  }

  it('leaves the original package.json when two packs run at once in one checkout', async () => {
    const { pkgDir, original, run } = heldPackage();
    const first = run('first');
    let second: ReturnType<typeof run> | undefined;
    try {
      await untilStartedOrEnded(pkgDir, first.child);
      rmSync(join(pkgDir, 'started'));
      second = run('second');
      await untilStartedOrEnded(pkgDir, second.child);
      writeFileSync(join(pkgDir, 'release'), '');
      expect(await first.ended, first.output()).toEqual({ code: 0, signal: null });
      await second.ended;
      expect(readFileSync(join(pkgDir, 'package.json'), 'utf8')).toBe(original);
      expect(second.output()).toContain('Another boardsmith pack holds the lock');
    } finally {
      writeFileSync(join(pkgDir, 'release'), '');
      for (const pack of [first, second]) {
        if (!pack) continue;
        if (running(pack.child)) pack.child.kill('SIGKILL');
        await pack.ended;
      }
    }
  });
});
