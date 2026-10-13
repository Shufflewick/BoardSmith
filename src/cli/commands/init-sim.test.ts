/**
 * EVERY GAME STARTS AS A SIMULATOR (#556, phase 5).
 *
 * `boardsmith init --sim` writes the table scaffold without its UI, so a designer can balance the
 * rules with `boardsmith simulate` before drawing anything, and `boardsmith add-ui` writes the UI
 * into that project later. Both scaffolds carry the simulator's sample files: card data in CSV,
 * metrics, a greedy policy and a test that plays seeded games with it.
 *
 * The projects are scaffolded by the real command and installed the way a real game is
 * (`smokeProject`), and the CLI is spawned against them, so what passes here is what a designer
 * gets. They are set up at the top of the file, where no test timeout applies (#363).
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { spawnCli } from '../spawn-cli.test-helper.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { freePort } from '../lib/free-port.js';
import { smokeProject } from './smoke-project.test-helper.js';
import { spawnDev } from './dev-project.test-helper.js';
import { doctorCommand } from './doctor.js';
import { initCommand, type InitOptions } from './init.js';

vi.setConfig({ testTimeout: 180_000 });

/** The files `boardsmith add-ui` writes, and the only files a table has that a simulator does not. */
const UI_FILES = [
  'index.html',
  'src/main.ts',
  'src/ui/App.vue',
  'src/ui/components/GameTable.vue',
  'src/ui/index.ts',
  'src/ui/uis.ts',
  'tests/a11y.example.test.ts',
  'tests/browser/smoke.spec.ts',
];

/** The simulator's sample files, which both scaffolds write. */
const SIM_SAMPLE_FILES = ['src/rules/data/cards.csv', 'src/rules/metrics.ts', 'src/sim/index.ts', 'tests/sim.test.ts'];

const NO_UI = 'This project has no UI yet. Run `boardsmith add-ui`.';

/** Every file under `dir`, relative and sorted, leaving out git's and npm's. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .filter((path) => !path.startsWith('.git/') && !path.startsWith('node_modules/'))
    .sort();
}

/** Scaffolds `name` with `options` in a temp tree of its own, quietly, and returns its directory. */
async function scaffold(name: string, options: InitOptions): Promise<string> {
  const parent = tempTree('bs-init-sim-');
  const cwd = process.cwd();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.chdir(parent);
  try {
    await initCommand(name, options);
  } finally {
    process.chdir(cwd);
    log.mockRestore();
  }
  return join(parent, name);
}

/** The action names a smoke spec lists. */
function specActions(dir: string): string[] {
  const listed = /actions: \[(.*)\],/.exec(readFileSync(join(dir, 'tests/browser/smoke.spec.ts'), 'utf-8'));
  return [...(listed?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

const tableFiles = filesUnder(await scaffold('demo', { withoutRulebook: true }));
const simDir = await scaffold('demo', { withoutRulebook: true, sim: true });

// A simulator project installed the way a real game is, for the commands that run it.
const sim = await smokeProject(false, {}, { sim: true });
const simTest = await spawnCli(['test'], sim);
const simulate = await spawnCli(['simulate', '--games', '3', '--policy', 'greedy', '--jobs', '1'], sim);
const simLint = await spawnCli(['lint'], sim);
const simValidate = await spawnCli(['validate'], sim);
const noUi = {
  build: await spawnCli(['build'], sim),
  smoke: await spawnCli(['smoke'], sim),
  // Refused before any key or network: `--dev` names a target, and no key is needed to get here.
  publish: await spawnCli(['publish', '--dev'], sim),
  dev: await spawnDev(sim, await freePort()).ended,
};

// A simulator whose first action the designer renamed, before adding the UI: the smoke spec
// add-ui writes must list the actions the game has now, not the ones init started it with.
const grown = await smokeProject(false, {}, { sim: true });
for (const file of ['src/rules/actions.ts', 'src/rules/flow.ts']) {
  const path = join(grown, file);
  writeFileSync(path, readFileSync(path, 'utf-8').replaceAll("'draw'", "'take'"));
}
const addUi = await spawnCli(['add-ui'], grown);
// The a11y example runs axe-core, which this checkout does not install (see smokeProject).
rmSync(join(grown, 'tests/a11y.example.test.ts'), { force: true });
const grownTypecheck = await spawnCli(['typecheck'], grown);
const grownBuild = await spawnCli(['build'], grown);

// The table scaffold as before, with the sample files.
const table = await smokeProject(false);
const tableTest = await spawnCli(['test'], table);
const tableLint = await spawnCli(['lint'], table);

describe('boardsmith init --sim (#556)', () => {
  it('writes the table scaffold without its UI files, and nothing else differs', () => {
    expect(tableFiles.filter((path) => !filesUnder(simDir).includes(path))).toEqual(UI_FILES);
    expect(filesUnder(simDir).filter((path) => !tableFiles.includes(path))).toEqual([]);
  });

  it('keeps the table scaffold dependencies, so adding the UI later needs no npm install', async () => {
    const tablePkg = JSON.parse(readFileSync(join(await scaffold('demo', { withoutRulebook: true }), 'package.json'), 'utf-8'));
    const simPkg = JSON.parse(readFileSync(join(simDir, 'package.json'), 'utf-8'));
    expect(simPkg.dependencies).toEqual(tablePkg.dependencies);
    expect(simPkg.devDependencies).toEqual(tablePkg.devDependencies);
  });

  it('refuses --sim with --world, creating nothing', async () => {
    const parent = tempTree('bs-init-sim-world-');
    const cwd = process.cwd();
    process.chdir(parent);
    try {
      await expect(initCommand('demo', { withoutRulebook: true, sim: true, world: true })).rejects.toThrow(
        /--sim .*--world/,
      );
    } finally {
      process.chdir(cwd);
    }
    expect(existsSync(join(parent, 'demo'))).toBe(false);
  });

  it('passes its own tests, the greedy simulation included', () => {
    expect(simTest.stdout + simTest.stderr).not.toMatch(/×|FAIL/);
    expect(simTest.stdout).toMatch(/tests\/sim\.test\.ts/);
    expect(simTest.code).toBe(0);
  });

  it('runs boardsmith simulate with its greedy policy', () => {
    expect(simulate.stderr).toBe('');
    expect(simulate.stdout).toMatch(/score/);
    expect(simulate.code).toBe(0);
  });

  it('passes boardsmith lint', () => {
    expect(simLint.stdout + simLint.stderr).toMatch(/Lint passed/);
    expect(simLint.code).toBe(0);
  });

  it('passes boardsmith validate, its Required Files check asking only for the rules', () => {
    expect(simValidate.stdout).toMatch(/Required Files: PASS/);
    expect(simValidate.stdout + simValidate.stderr).not.toMatch(/FAIL/);
    expect(simValidate.code).toBe(0);
  });

  it.each(['build', 'smoke', 'publish'] as const)('stops boardsmith %s with the no-UI message', (command) => {
    expect(noUi[command].stdout + noUi[command].stderr).toContain(NO_UI);
    expect(noUi[command].code).not.toBe(0);
  });

  it('stops boardsmith dev with the no-UI message', () => {
    expect(noUi.dev.stuck).toBe(false);
    expect(noUi.dev.output).toContain(NO_UI);
    expect(noUi.dev.code).not.toBe(0);
  });

  it('is a healthy project to boardsmith doctor', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect((await doctorCommand({ project: simDir, quiet: true })).findings).toEqual([]);
    } finally {
      log.mockRestore();
      process.exitCode = undefined;
    }
  });
});

describe('boardsmith add-ui (#556)', () => {
  it('writes the UI files into a simulator project', () => {
    expect(addUi.stderr).toBe('');
    expect(addUi.code).toBe(0);
    for (const file of UI_FILES.filter((path) => path !== 'tests/a11y.example.test.ts')) {
      expect(existsSync(join(grown, file)), file).toBe(true);
    }
  });

  it("lists the game's own actions in the smoke spec, read from its rules", () => {
    expect(specActions(grown)).toEqual(['take', 'play']);
  });

  it('leaves a project that type-checks and builds', () => {
    expect(grownTypecheck.stdout + grownTypecheck.stderr).not.toMatch(/error TS/);
    expect(grownTypecheck.code).toBe(0);
    expect(grownBuild.stdout + grownBuild.stderr).toMatch(/Build complete/);
    expect(grownBuild.code).toBe(0);
  });

  it('refuses, listing them and writing nothing, when any UI file already exists', async () => {
    const dir = await scaffold('demo', { withoutRulebook: true, sim: true });
    writeFileSync(join(dir, 'index.html'), '<!-- mine -->\n');
    writeFileSync(join(dir, 'src/main.ts'), '// mine\n');
    const before = filesUnder(dir);

    const refused = await spawnCli(['add-ui'], dir);

    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toMatch(/index\.html/);
    expect(refused.stderr).toMatch(/src\/main\.ts/);
    expect(filesUnder(dir)).toEqual(before);
    expect(readFileSync(join(dir, 'index.html'), 'utf-8')).toBe('<!-- mine -->\n');
  });

  it('refuses a persistent world, which init --world already gave its UI', async () => {
    const dir = await scaffold('demo-world', { withoutRulebook: true, world: true });
    const refused = await spawnCli(['add-ui'], dir);
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toMatch(/persistent world/);
  });
});

describe('the table scaffold (#556)', () => {
  it('writes the simulator sample files too', () => {
    for (const file of SIM_SAMPLE_FILES) expect(tableFiles).toContain(file);
  });

  it('passes boardsmith lint', () => {
    expect(tableLint.stdout + tableLint.stderr).toMatch(/Lint passed/);
    expect(tableLint.code).toBe(0);
  });

  it("lists the scaffold game's actions in its smoke spec", () => {
    expect(specActions(table)).toEqual(['draw', 'play']);
  });

  it('passes its own tests, the greedy simulation included', () => {
    expect(tableTest.stdout + tableTest.stderr).not.toMatch(/×|FAIL/);
    expect(tableTest.stdout).toMatch(/tests\/sim\.test\.ts/);
    expect(tableTest.code).toBe(0);
  });
});
