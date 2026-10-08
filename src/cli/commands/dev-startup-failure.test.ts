/**
 * `boardsmith dev` THAT NEVER GETS STARTED REMOVES ITS BUILD DIRECTORY TOO (#543).
 *
 * Each run makes a build directory of its own under `.boardsmith/`. A run that stops on Ctrl+C
 * removes it through its teardown, but a run that fails during startup (rules that do not load, a
 * flag the game refuses) used to end without running that teardown, so every failed start left one
 * more `dev-tmp-*` directory behind.
 *
 * Spawned through the real CLI, because what is under test is how the PROCESS ends.
 */
import { describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { devProject, spawnDev } from './dev-project.test-helper.js';
import { freePort } from '../lib/free-port.js';
import { commandBuildDirs } from '../lib/command-build-dirs.test-helper.js';

// Each run bundles the project's rules. A hang guard, not a budget.
vi.setConfig({ testTimeout: 120_000 });

describe('boardsmith dev that fails during startup (#543)', () => {
  it('removes its build directory when the rules do not load', async () => {
    const cwd = await devProject(false);
    writeFileSync(join(cwd, 'src', 'rules', 'index.ts'), 'export const gameDefinition = ;\n');

    const ended = await spawnDev(cwd, await freePort()).ended;

    expect(ended.stuck, ended.output).toBe(false);
    expect(ended.code, ended.output).toBe(1);
    expect(ended.output).toContain("Failed to load this game's rules");
    expect(commandBuildDirs(cwd, 'dev'), `the build directory was left behind:\n${ended.output}`).toEqual([]);
  });

  it('removes its build directory when --players is outside the game’s seat range', async () => {
    const cwd = await devProject(false);

    const ended = await spawnDev(cwd, await freePort(), ['--players', '99']).ended;

    expect(ended.stuck, ended.output).toBe(false);
    expect(ended.code, ended.output).toBe(1);
    expect(ended.output).toContain('--players');
    expect(commandBuildDirs(cwd, 'dev'), `the build directory was left behind:\n${ended.output}`).toEqual([]);
  });
});
