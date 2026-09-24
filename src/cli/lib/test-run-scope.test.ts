import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { generateScaffoldFiles, type ProjectConfig } from './project-scaffold.js';
import { generateVitestConfig, testRunScopeProblem, VITEST_CONFIG_FILE } from './test-run-scope.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';

/**
 * #298: chunks built side by side live in git worktrees under `.boardsmith/worktrees/<slug>`,
 * inside the game project, and vitest's discovery walks into dot-directories. A game project's
 * own vitest config is the one place that keeps them out, so a plain `npx vitest run`, `boardsmith
 * test`, `constraint-check` and `chunk-merge` all run the main checkout's tests and nothing else.
 */

const OK_TEST = "import { it } from 'vitest';\nit('holds', () => {});\n";
const WIP_TEST = "import { it, expect } from 'vitest';\nit('is still being built', () => { expect(1).toBe(2); });\n";

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await fs.mkdir(join(root, path, '..'), { recursive: true });
    await fs.writeFile(join(root, path), content);
  }
}

/** Every file `boardsmith init` writes for this config, on disk in a fresh directory. */
async function scaffold(config: ProjectConfig): Promise<string> {
  const tree = tempTree('bs-test-scope-');
  const project = join(tree, config.name);
  await fs.mkdir(project, { recursive: true });
  const files = Object.fromEntries(generateScaffoldFiles(config, project).map((f) => [f.path, f.content]));
  await writeTree(project, files);
  return project;
}

const TABLE: ProjectConfig = {
  name: 'scope-table',
  displayName: 'Scope Table',
  description: 'A table game.',
  backend: 'table',
  playerCount: { min: 2, max: 2 },
};

const WORLD: ProjectConfig = {
  name: 'scope-world',
  displayName: 'Scope World',
  description: 'A persistent world.',
  backend: 'world',
};

describe('a scaffolded project leaves chunk worktrees out of its default test run', () => {
  for (const config of [TABLE, WORLD]) {
    it(`${config.backend}: plain vitest run passes with a failing test under .boardsmith/worktrees/x`, async () => {
      const project = await scaffold(config);
      // Only the configs are under test here; the scaffold's own example tests need the game
      // sources `init` writes separately, so the run is given one test of its own instead.
      for (const example of await fs.readdir(join(project, 'tests')).catch(() => [])) {
        await fs.rm(join(project, 'tests', example));
      }
      await writeTree(project, {
        'tests/ok.test.ts': OK_TEST,
        '.boardsmith/worktrees/x/tests/wip.test.ts': WIP_TEST,
      });
      await fs.symlink(INSTALLED_MODULES, join(project, 'node_modules'), 'dir');

      expect(await testRunScopeProblem(project)).toBeUndefined();
      const run = spawnSync(join(INSTALLED_MODULES, '.bin', 'vitest'), ['run'], { cwd: project, encoding: 'utf-8' });
      const output = `${run.stdout}${run.stderr}`;
      expect(output).toContain('ok.test.ts');
      expect(output).not.toContain('wip.test.ts');
      expect(run.status).toBe(0);
    }, 60_000);
  }
});

describe('testRunScopeProblem', () => {
  const project = async (files: Record<string, string>) => {
    const tree = tempTree('bs-test-scope-');
    const dir = join(tree, 'game');
    await fs.mkdir(dir, { recursive: true });
    await writeTree(dir, files);
    return dir;
  };

  it('accepts the vitest config BoardSmith writes', async () => {
    const dir = await project({
      'vite.config.ts': 'export default {};\n',
      [VITEST_CONFIG_FILE]: generateVitestConfig('vite.config.ts'),
    });
    expect(await testRunScopeProblem(dir)).toBeUndefined();
  });

  it('accepts a vite config that carries the exclusion itself when there is no vitest config', async () => {
    const dir = await project({ 'vite.config.mjs': "export default { test: { exclude: ['.boardsmith/**'] } };\n" });
    expect(await testRunScopeProblem(dir)).toBeUndefined();
  });

  it('names a vitest config that does not leave .boardsmith/ out, and says how to fix it', async () => {
    const dir = await project({
      'vite.config.ts': "export default { test: { exclude: ['.boardsmith/**'] } };\n",
      'vitest.config.ts': 'export default { test: { globals: true } };\n',
    });
    const problem = await testRunScopeProblem(dir);
    expect(problem).toMatch(/vitest\.config\.ts/);
    expect(problem).toMatch(/\.boardsmith\/\*\*/);
    expect(problem).toMatch(/configDefaults\.exclude/);
  });

  it('points a project with no exclusion anywhere at boardsmith doctor --fix', async () => {
    const dir = await project({ 'vite.config.ts': 'export default {};\n' });
    expect(await testRunScopeProblem(dir)).toMatch(/boardsmith doctor --fix/);
  });
});
