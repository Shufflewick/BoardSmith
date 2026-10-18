/**
 * #882: THE WORLD HOST WATCHES THE RULES IT LOADS.
 *
 * It watched a hard-coded `src/rules` while loading from `paths.rules`, so with
 * a custom rules folder a save reached the browser through Vite and never the
 * world: the mixed-version world #201 exists to prevent. Driven through the
 * real host and its real Vite watcher, in a `boardsmith init --world` project.
 */
import { describe, it, expect, vi } from 'vitest';
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadWorldRuntime, startWorldDevServer } from './dev-world.js';
import { makeCommandBuildDir } from '../lib/command-build-dir.js';
import { hostHoldings } from '../dev-host/shutdown.js';
import { freePort } from '../lib/free-port.js';
import { devProject, spawnDev } from './dev-project.test-helper.js';

// Each run bundles the project's rules, which under full-suite parallelism can
// exceed Vitest's default. A hang guard, not a budget.
vi.setConfig({ testTimeout: 90_000 });

/** Serve `cwd`'s world with its rules in `rulesDir`, save a rules file, and expect the world to reload. */
async function reloadsOnSave(cwd: string, rulesDir: string): Promise<void> {
  const tempDir = makeCommandBuildDir(cwd, 'dev');
  const reloadRules = vi.fn(() => loadWorldRuntime(rulesDir, tempDir, 'standalone'));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const host = await startWorldDevServer({
    cwd,
    uiPath: cwd,
    rulesDir,
    runtime: await loadWorldRuntime(rulesDir, tempDir, 'standalone'),
    displayName: 'Rules Dir Game',
    context: 'standalone',
    port: await freePort(),
    host: '127.0.0.1',
    holdings: hostHoldings(),
    openBrowser: false,
    reloadRules,
  });
  try {
    // A save made before the watcher is ready is not an edit it can miss on
    // purpose, so keep saving until the host reloads or the guard runs out.
    await vi.waitFor(
      () => {
        if (reloadRules.mock.calls.length === 0) appendFileSync(join(rulesDir, 'index.ts'), '\n// saved\n');
        expect(reloadRules).toHaveBeenCalled();
      },
      { timeout: 30_000, interval: 500 },
    );
  } finally {
    await host.stop();
    log.mockRestore();
  }
}

describe('#882: the world host reloads on a save in the rules folder it loads from', () => {
  it('a custom rules folder (`paths.rules`)', async () => {
    const cwd = await devProject(true);
    const rulesDir = join(cwd, 'game-rules');
    renameSync(join(cwd, 'src', 'rules'), rulesDir);
    await reloadsOnSave(cwd, rulesDir);
  });

  it('the default `src/rules`', async () => {
    const cwd = await devProject(true);
    await reloadsOnSave(cwd, join(cwd, 'src', 'rules'));
  });
});

describe('#1037: `boardsmith dev` on a world project watches the rules folder its config names', () => {
  it('reloads the world on a save in `paths.rules`', async () => {
    const cwd = await devProject(true);
    renameSync(join(cwd, 'src', 'rules'), join(cwd, 'game-rules'));
    const configPath = join(cwd, 'boardsmith.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    writeFileSync(configPath, JSON.stringify({ ...config, paths: { ...config.paths, rules: 'game-rules' } }, null, 2));
    const run = spawnDev(cwd, await freePort());
    try {
      await vi.waitFor(() => expect(run.output()).toContain('Ready!'), { timeout: 60_000, interval: 200 });
      const reloaded = `${join('game-rules', 'index.ts')} changed -- reloading the world's rules`;
      // A save made before the watcher is ready is not one it can miss on purpose, so keep saving.
      await vi.waitFor(
        () => {
          if (!run.output().includes(reloaded)) appendFileSync(join(cwd, 'game-rules', 'index.ts'), '\n// saved\n');
          expect(run.output()).toContain(reloaded);
        },
        { timeout: 30_000, interval: 500 },
      );
    } finally {
      run.child.kill('SIGINT');
      await run.ended;
    }
  });
});
