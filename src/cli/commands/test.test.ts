import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { spawnCli } from '../spawn-cli.test-helper.js';
import { generateVitestConfig, VITEST_CONFIG_FILE } from '../lib/test-run-scope.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * `boardsmith test` in a game project runs the main checkout's tests only (#298): the chunk
 * worktrees under `.boardsmith/worktrees/` are left out by the project's vitest config, and a
 * project whose config would collect them is refused before vitest starts.
 */
async function gameProject(files: Record<string, string>): Promise<string> {
  const project = join(tempTree('bs-test-cmd-'), 'game');
  const all: Record<string, string> = {
    'boardsmith.json': '{"name":"game"}\n',
    'vite.config.ts': 'export default {};\n',
    'tests/ok.test.ts': "import { it } from 'vitest';\nit('holds', () => {});\n",
    '.boardsmith/worktrees/x/tests/wip.test.ts':
      "import { it, expect } from 'vitest';\nit('is still being built', () => { expect(1).toBe(2); });\n",
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    await fs.mkdir(join(project, path, '..'), { recursive: true });
    await fs.writeFile(join(project, path), content);
  }
  await fs.symlink(INSTALLED_MODULES, join(project, 'node_modules'), 'dir');
  return project;
}

describe('boardsmith test', () => {
  it('runs the main checkout\'s tests and not the chunk worktrees\'', async () => {
    const project = await gameProject({ [VITEST_CONFIG_FILE]: generateVitestConfig('vite.config.ts') });
    const run = await spawnCli(['test'], project);
    expect(run.stdout).toContain('ok.test.ts');
    expect(run.stdout + run.stderr).not.toContain('wip.test.ts');
    expect(run.code).toBe(0);
  });

  it('refuses a project whose vitest config would collect the chunk worktrees, and says how to fix it', async () => {
    const project = await gameProject({});
    const run = await spawnCli(['test'], project);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/vite\.config\.ts does not leave \.boardsmith\/ out of test runs/);
    expect(run.stderr).toMatch(/boardsmith doctor --fix/);
    expect(run.stdout + run.stderr).not.toContain('wip.test.ts');
  });
});
