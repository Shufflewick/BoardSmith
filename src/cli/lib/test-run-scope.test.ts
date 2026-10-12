import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { generateScaffoldFiles, type ProjectConfig } from './project-scaffold.js';
import { GAME_VITE_CONFIG, testRunScopeProblem } from './test-run-scope.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES, linkGameModules } from '../../testing/installed-modules.test-helper.js';

/**
 * #298: chunks built side by side live in git worktrees under `.boardsmith/worktrees/<slug>`,
 * inside the game project, and vitest's discovery walks into dot-directories. The config a game
 * builds with `defineGameViteConfig` (#528) keeps them out, so a plain `npx vitest run`, `boardsmith
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

describe('a scaffolded project leaves chunk worktrees and the browser smoke test out of its default test run', () => {
  for (const config of [TABLE, WORLD]) {
    it(`${config.backend}: plain vitest run passes with a failing test under .boardsmith/worktrees/x and tests/browser/`, async () => {
      const project = await scaffold(config);
      // Only the configs are under test here; the scaffold's own example tests need the game
      // sources `init` writes separately, so the run is given one test of its own instead.
      for (const example of await fs.readdir(join(project, 'tests')).catch(() => [])) {
        await fs.rm(join(project, 'tests', example));
      }
      await writeTree(project, {
        'tests/ok.test.ts': OK_TEST,
        '.boardsmith/worktrees/x/tests/wip.test.ts': WIP_TEST,
        // The in-browser smoke test runs under Playwright only (#453); vitest must not collect it,
        // nor a copy of it in a git worktree kept inside the project.
        'tests/browser/smoke.spec.ts': WIP_TEST,
        '.worktrees/x/tests/browser/smoke.spec.ts': WIP_TEST,
      });
      linkGameModules(project);

      expect(await testRunScopeProblem(project)).toBeUndefined();
      const run = spawnSync(join(INSTALLED_MODULES, '.bin', 'vitest'), ['run'], { cwd: project, encoding: 'utf-8' });
      const output = `${run.stdout}${run.stderr}`;
      expect(output).toContain('ok.test.ts');
      expect(output).not.toContain('wip.test.ts');
      expect(output).not.toContain('smoke.spec.ts');
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

  it('accepts a vite config built with defineGameViteConfig, with no vitest config (#528)', async () => {
    const dir = await project({ 'vite.config.ts': GAME_VITE_CONFIG });
    expect(await testRunScopeProblem(dir)).toBeUndefined();
  });

  it("accepts a game's own overrides passed to defineGameViteConfig", async () => {
    const dir = await project({
      'vite.config.ts':
        "import { defineGameViteConfig } from 'boardsmith/vite-config';\n" +
        "export default defineGameViteConfig({ test: { setupFiles: ['./tests/setup.ts'] } });\n",
    });
    expect(await testRunScopeProblem(dir)).toBeUndefined();
  });

  it('refuses a config that does not build with defineGameViteConfig, naming the import and doctor --fix', async () => {
    const dir = await project({ 'vite.config.ts': "export default { test: { exclude: ['.boardsmith/**', '**/tests/browser/**'] } };\n" });
    const problem = await testRunScopeProblem(dir);
    expect(problem).toMatch(/^vite\.config\.ts does not build its config with defineGameViteConfig/);
    expect(problem).toContain("import { defineGameViteConfig } from 'boardsmith/vite-config';");
    expect(problem).toMatch(/boardsmith doctor --fix/);
  });

  it('is not fooled by the import written in a comment', async () => {
    const dir = await project({
      'vite.config.ts': `// ${GAME_VITE_CONFIG.replace(/\n/g, ' ')}\nexport default {};\n`,
    });
    expect(await testRunScopeProblem(dir)).toMatch(/does not build its config with defineGameViteConfig/);
  });

  it('reads the config vitest loads, so a vitest config beside a good vite config is refused', async () => {
    const dir = await project({ 'vite.config.ts': GAME_VITE_CONFIG, 'vitest.config.ts': 'export default {};\n' });
    expect(await testRunScopeProblem(dir)).toMatch(/^vitest\.config\.ts does not build its config with defineGameViteConfig/);
  });

  it('refuses a project with no config at all', async () => {
    const dir = await project({});
    expect(await testRunScopeProblem(dir)).toMatch(/^This project has no vite\.config\.ts.*boardsmith doctor --fix/s);
  });
});
