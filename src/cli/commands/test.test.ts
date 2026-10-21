import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnCli } from '../spawn-cli.test-helper.js';
import { GAME_VITE_CONFIG } from '../lib/test-run-scope.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { linkGameModules } from '../../testing/installed-modules.test-helper.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * `boardsmith test` in a game project runs the main checkout's tests only (#298): the chunk
 * worktrees under `.boardsmith/worktrees/` are left out by the project's config, and a
 * project whose config would collect them is refused before vitest starts.
 */
async function gameProject(files: Record<string, string>): Promise<string> {
  const tree = tempTree('bs-test-cmd-');
  const project = join(tree, 'game');
  const all: Record<string, string> = {
    'boardsmith.json': '{"name":"game"}\n',
    // An ES module package, as `boardsmith init` writes it, so its config can import boardsmith.
    'package.json': '{ "type": "module" }\n',
    'vite.config.ts': GAME_VITE_CONFIG,
    'tests/ok.test.ts': "import { it } from 'vitest';\nit('holds', () => {});\n",
    '.boardsmith/worktrees/x/tests/wip.test.ts':
      "import { it, expect } from 'vitest';\nit('is still being built', () => { expect(1).toBe(2); });\n",
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    await fs.mkdir(join(project, path, '..'), { recursive: true });
    await fs.writeFile(join(project, path), content);
  }
  linkGameModules(project);
  return project;
}

describe('boardsmith test', () => {
  it('runs the main checkout\'s tests and not the chunk worktrees\'', async () => {
    const project = await gameProject({});
    const run = await spawnCli(['test'], project);
    expect(run.stdout).toContain('ok.test.ts');
    expect(run.stdout + run.stderr).not.toContain('wip.test.ts');
    expect(run.code).toBe(0);
  });

  it('refuses a project whose vitest config would collect the chunk worktrees, and says how to fix it', async () => {
    const project = await gameProject({ 'vite.config.ts': 'export default {};\n' });
    const run = await spawnCli(['test'], project);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/vite\.config\.ts does not build its config with defineGameViteConfig/);
    expect(run.stderr).toMatch(/boardsmith doctor --fix/);
    expect(run.stdout + run.stderr).not.toContain('wip.test.ts');
  });

  it('refuses a game with no tests/ directory, since a run of nothing would pass (#728)', async () => {
    const project = await gameProject({});
    await fs.rm(join(project, 'tests'), { recursive: true });
    const run = await spawnCli(['test'], project);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/This project has no tests\/ directory, so nothing tests it\./);
  });

  it('runs the browser suite under --browser without type-checking again, since the default run did', async () => {
    // A filter matching no browser regression, so no Chromium starts: what is
    // asserted is that vitest was handed the browser config and no type check ran first.
    const run = await spawnCli(['test', '--browser', 'no-such-browser-regression']);
    expect(run.stdout).not.toContain('Type-checking');
    expect(run.stdout + run.stderr).toContain('scripts/browser-regressions.browser-test.mjs');
  });

  it('refuses --browser in a game project, which has no browser regressions, and names the check that has', async () => {
    const project = await gameProject({});
    const run = await spawnCli(['test', '--browser'], project);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/--browser runs BoardSmith's own browser regressions/);
    expect(run.stderr).toMatch(/boardsmith smoke/);
    expect(run.stdout).not.toContain('ok.test.ts');
  });
});

/** Starts, says so, and outlives nothing: once vitest is gone it ends its own worker. */
const SLOW_TEST = [
  "import { it } from 'vitest';",
  "import { writeFileSync } from 'node:fs';",
  "it('is still running when the run is stopped', async () => {",
  '  const vitest = process.ppid;',
  "  writeFileSync('slow-started', '');",
  '  while (process.ppid === vitest) await new Promise((r) => setTimeout(r, 50));',
  "  process.kill(process.pid, 'SIGKILL');",
  '}, 60_000);',
  '',
].join('\n');

/** Waits for the slow file to be running, then kills the vitest process that runs them both. */
const KILLS_VITEST_TEST = [
  "import { it } from 'vitest';",
  "import { existsSync } from 'node:fs';",
  "it('stops the run', async () => {",
  "  for (let i = 0; i < 600 && !existsSync('slow-started'); i++) await new Promise((r) => setTimeout(r, 50));",
  "  process.kill(process.ppid, 'SIGKILL');",
  "  process.kill(process.pid, 'SIGKILL');",
  '}, 60_000);',
  '',
].join('\n');

/**
 * #429: a run that ends without vitest's summary says why, and where the rest is.
 *
 * The repo's merge gate refused merges with nothing but "Tests failed with exit code 1" when the
 * vitest process died partway: no summary, no failing test, no reason. These drive a real
 * `boardsmith test` whose vitest really is killed, from inside the run.
 */
describe('boardsmith test reports how a run ended when vitest does not finish it (#429)', () => {

  /**
   * The log a verdict points at, read back. A failed run keeps its record for
   * a person to read; these failures are planted, so the record goes once read.
   */
  async function logNamedIn(text: string): Promise<string> {
    const path = /Full output: (\S+)/.exec(text)?.[1];
    expect(path, text).toBeDefined();
    const log = await fs.readFile(path!, 'utf-8');
    await fs.rm(dirname(path!), { recursive: true });
    return log;
  }

  it('names the signal, the files still running, and a log that holds the whole output, when vitest is killed', async () => {
    const project = await gameProject({
      'tests/slow.test.ts': SLOW_TEST,
      'tests/kills-vitest.test.ts': KILLS_VITEST_TEST,
    });

    const run = await spawnCli(['test'], project);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('vitest was stopped by SIGKILL before it finished, so this run has no result.');
    expect(run.stderr).toMatch(/Still running when it stopped \(\d\):/);
    expect(run.stderr).toContain('  tests/slow.test.ts');
    expect(run.stderr).toContain('  tests/kills-vitest.test.ts');
    // What vitest printed before it was stopped is in the log as well as on the terminal.
    const log = await logNamedIn(run.stderr);
    expect(log).toContain('RUN  v');
    expect(run.stdout).toContain('RUN  v');
  });

  it('names a file whose worker died, which ends vitest 3 before it finishes', async () => {
    const project = await gameProject({
      'tests/worker-dies.test.ts':
        "import { it } from 'vitest';\nit('ends its own worker', () => { process.kill(process.pid, 'SIGKILL'); });\n",
    });

    const run = await spawnCli(['test'], project);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('vitest exited with code 1 before it finished, so this run has no result.');
    expect(run.stderr).toContain('Still running when it stopped (1):\n  tests/worker-dies.test.ts');
    // vitest 3's worker pool rejects its next message to the dead worker, and that ends the run.
    expect(await logNamedIn(run.stderr)).toContain('Error: Channel closed');
  });

  it('names the failing file of an ordinary failure, and writes the same verdict to --verdict-file', async () => {
    const project = await gameProject({
      'tests/fails.test.ts': "import { it, expect } from 'vitest';\nit('fails', () => { expect(1).toBe(2); });\n",
    });
    const verdictFile = join(project, '..', 'verdict.txt');

    const run = await spawnCli(['test', '--verdict-file', verdictFile], project);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('Tests failed in 1 file:\n  tests/fails.test.ts');
    const written = await fs.readFile(verdictFile, 'utf-8');
    expect(written).toContain('Tests failed in 1 file:\n  tests/fails.test.ts');
    expect(await logNamedIn(written)).toContain('fails.test.ts');
  });

  it('leaves no record behind and writes no verdict when the run passes', async () => {
    const project = await gameProject({});
    const verdictFile = join(project, '..', 'verdict.txt');

    const run = await spawnCli(['test', '--verdict-file', verdictFile], project);

    expect(run.code).toBe(0);
    expect(run.stdout + run.stderr).not.toContain('Full output:');
    await expect(fs.stat(verdictFile)).rejects.toThrow();
  });
});
